import { randomUUID } from "node:crypto";
import {
  captureWsEvent,
  createDebugProxyWebSocketAgent,
  resolveDebugProxySettings,
} from "openclaw/plugin-sdk/proxy-capture";
import type {
  RealtimeTranscriptionProviderConfig,
  RealtimeTranscriptionProviderPlugin,
  RealtimeTranscriptionSession,
  RealtimeTranscriptionSessionCreateRequest,
} from "openclaw/plugin-sdk/realtime-transcription";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import WebSocket from "ws";

type MistralRealtimeTranscriptionEncoding =
  | "pcm_s16le"
  | "pcm_s32le"
  | "pcm_f16le"
  | "pcm_f32le"
  | "pcm_mulaw"
  | "pcm_alaw";

type MistralRealtimeTranscriptionProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  sampleRate?: number;
  encoding?: MistralRealtimeTranscriptionEncoding;
  targetStreamingDelayMs?: number;
};

type MistralRealtimeTranscriptionSessionConfig = RealtimeTranscriptionSessionCreateRequest & {
  apiKey: string;
  baseUrl: string;
  model: string;
  sampleRate: number;
  encoding: MistralRealtimeTranscriptionEncoding;
  targetStreamingDelayMs?: number;
};

type MistralRealtimeTranscriptionEvent = {
  type?: string;
  text?: string;
  error?: {
    message?: unknown;
    code?: number;
  };
};

const MISTRAL_REALTIME_DEFAULT_BASE_URL = "wss://api.mistral.ai";
const MISTRAL_REALTIME_DEFAULT_MODEL = "voxtral-mini-transcribe-realtime-2602";
const MISTRAL_REALTIME_DEFAULT_SAMPLE_RATE = 8000;
const MISTRAL_REALTIME_DEFAULT_ENCODING: MistralRealtimeTranscriptionEncoding = "pcm_mulaw";
const MISTRAL_REALTIME_DEFAULT_DELAY_MS = 800;
const MISTRAL_REALTIME_CONNECT_TIMEOUT_MS = 10_000;
const MISTRAL_REALTIME_CLOSE_TIMEOUT_MS = 5_000;
const MISTRAL_REALTIME_MAX_RECONNECT_ATTEMPTS = 5;
const MISTRAL_REALTIME_RECONNECT_DELAY_MS = 1000;
const MISTRAL_REALTIME_MAX_QUEUED_BYTES = 2 * 1024 * 1024;

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNestedMistralConfig(rawConfig: RealtimeTranscriptionProviderConfig) {
  const raw = readRecord(rawConfig);
  const providers = readRecord(raw?.providers);
  return readRecord(providers?.mistral ?? raw?.mistral ?? raw) ?? {};
}

function readFiniteNumber(value: unknown): number | undefined {
  const next =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : undefined;
  return Number.isFinite(next) ? next : undefined;
}

function normalizeMistralEncoding(
  value: unknown,
): MistralRealtimeTranscriptionEncoding | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  switch (normalized) {
    case "pcm":
    case "linear16":
    case "pcm_s16le":
      return "pcm_s16le";
    case "pcm_s32le":
    case "pcm_f16le":
    case "pcm_f32le":
      return normalized;
    case "mulaw":
    case "ulaw":
    case "g711_ulaw":
    case "g711-mulaw":
    case "pcm_mulaw":
      return "pcm_mulaw";
    case "alaw":
    case "g711_alaw":
    case "g711-alaw":
    case "pcm_alaw":
      return "pcm_alaw";
    default:
      throw new Error(`Invalid Mistral realtime transcription encoding: ${normalized}`);
  }
}

function normalizeMistralRealtimeBaseUrl(value?: string): string {
  const raw = normalizeOptionalString(value ?? process.env.MISTRAL_REALTIME_BASE_URL);
  if (!raw) {
    return MISTRAL_REALTIME_DEFAULT_BASE_URL;
  }
  const url = new URL(raw);
  url.protocol =
    url.protocol === "http:" ? "ws:" : url.protocol === "https:" ? "wss:" : url.protocol;
  url.pathname = url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

function toMistralRealtimeWsUrl(config: MistralRealtimeTranscriptionSessionConfig): string {
  const base = new URL(`${normalizeMistralRealtimeBaseUrl(config.baseUrl)}/`);
  const url = new URL("v1/audio/transcriptions/realtime", base);
  url.searchParams.set("model", config.model);
  if (config.targetStreamingDelayMs != null) {
    url.searchParams.set("target_streaming_delay_ms", String(config.targetStreamingDelayMs));
  }
  return url.toString();
}

function normalizeProviderConfig(
  config: RealtimeTranscriptionProviderConfig,
): MistralRealtimeTranscriptionProviderConfig {
  const raw = readNestedMistralConfig(config);
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw.apiKey,
      path: "plugins.entries.voice-call.config.streaming.providers.mistral.apiKey",
    }),
    baseUrl: normalizeOptionalString(raw.baseUrl),
    model: normalizeOptionalString(raw.model ?? raw.sttModel),
    sampleRate: readFiniteNumber(raw.sampleRate ?? raw.sample_rate),
    encoding: normalizeMistralEncoding(raw.encoding),
    targetStreamingDelayMs: readFiniteNumber(
      raw.targetStreamingDelayMs ?? raw.target_streaming_delay_ms ?? raw.delayMs,
    ),
  };
}

function rawWsDataToBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function readErrorDetail(event: MistralRealtimeTranscriptionEvent): string {
  const message = event.error?.message;
  if (typeof message === "string") {
    return message;
  }
  if (message && typeof message === "object") {
    return JSON.stringify(message);
  }
  if (typeof event.error?.code === "number") {
    return `Mistral realtime transcription error (${event.error.code})`;
  }
  return "Mistral realtime transcription error";
}

class MistralRealtimeTranscriptionSession implements RealtimeTranscriptionSession {
  private ws: WebSocket | null = null;
  private connected = false;
  private ready = false;
  private closed = false;
  private reconnectAttempts = 0;
  private queuedAudio: Buffer[] = [];
  private queuedBytes = 0;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private partialText = "";
  private reconnecting = false;
  private readonly flowId = randomUUID();

  constructor(private readonly config: MistralRealtimeTranscriptionSessionConfig) {}

  async connect(): Promise<void> {
    this.closed = false;
    this.reconnectAttempts = 0;
    await this.doConnect();
  }

  sendAudio(audio: Buffer): void {
    if (this.closed || audio.byteLength === 0) {
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN && this.ready) {
      this.sendJson({
        type: "input_audio.append",
        audio: audio.toString("base64"),
      });
      return;
    }
    this.queueAudio(audio);
  }

  close(): void {
    this.closed = true;
    this.connected = false;
    this.queuedAudio = [];
    this.queuedBytes = 0;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.forceClose();
      return;
    }
    this.sendJson({ type: "input_audio.flush" });
    this.sendJson({ type: "input_audio.end" });
    this.closeTimer = setTimeout(() => this.forceClose(), MISTRAL_REALTIME_CLOSE_TIMEOUT_MS);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async doConnect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const url = toMistralRealtimeWsUrl(this.config);
      const debugProxy = resolveDebugProxySettings();
      const proxyAgent = createDebugProxyWebSocketAgent(debugProxy);
      let settled = false;
      let opened = false;
      const finishConnect = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimeout);
        this.ready = true;
        this.flushQueuedAudio();
        resolve();
      };
      const failConnect = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimeout);
        this.config.onError?.(error);
        this.closed = true;
        this.forceClose();
        reject(error);
      };
      this.ready = false;
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        ...(proxyAgent ? { agent: proxyAgent } : {}),
      });

      const connectTimeout = setTimeout(() => {
        failConnect(new Error("Mistral realtime transcription connection timeout"));
      }, MISTRAL_REALTIME_CONNECT_TIMEOUT_MS);

      this.ws.on("open", () => {
        opened = true;
        this.connected = true;
        this.reconnectAttempts = 0;
        captureWsEvent({
          url,
          direction: "local",
          kind: "ws-open",
          flowId: this.flowId,
          meta: { provider: "mistral", capability: "realtime-transcription" },
        });
      });

      this.ws.on("message", (data) => {
        const payload = rawWsDataToBuffer(data);
        captureWsEvent({
          url,
          direction: "inbound",
          kind: "ws-frame",
          flowId: this.flowId,
          payload,
          meta: { provider: "mistral", capability: "realtime-transcription" },
        });
        try {
          const event = JSON.parse(payload.toString()) as MistralRealtimeTranscriptionEvent;
          if (event.type === "session.created") {
            this.sendJson({
              type: "session.update",
              session: {
                audio_format: {
                  encoding: this.config.encoding,
                  sample_rate: this.config.sampleRate,
                },
              },
            });
            finishConnect();
            return;
          }
          if (!this.ready && event.type === "error") {
            failConnect(new Error(readErrorDetail(event)));
            return;
          }
          this.handleEvent(event);
        } catch (error) {
          this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      });

      this.ws.on("error", (error) => {
        captureWsEvent({
          url,
          direction: "local",
          kind: "error",
          flowId: this.flowId,
          errorText: error instanceof Error ? error.message : String(error),
          meta: { provider: "mistral", capability: "realtime-transcription" },
        });
        if (!opened) {
          failConnect(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
      });

      this.ws.on("close", () => {
        clearTimeout(connectTimeout);
        this.connected = false;
        this.ready = false;
        if (this.closeTimer) {
          clearTimeout(this.closeTimer);
          this.closeTimer = undefined;
        }
        if (this.closed || !opened || !settled) {
          return;
        }
        void this.attemptReconnect();
      });
    });
  }

  private async attemptReconnect(): Promise<void> {
    if (this.closed || this.reconnecting) {
      return;
    }
    if (this.reconnectAttempts >= MISTRAL_REALTIME_MAX_RECONNECT_ATTEMPTS) {
      this.config.onError?.(new Error("Mistral realtime transcription reconnect limit reached"));
      return;
    }
    this.reconnectAttempts += 1;
    const delay = MISTRAL_REALTIME_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    this.reconnecting = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!this.closed) {
        await this.doConnect();
      }
    } catch {
      if (!this.closed) {
        this.reconnecting = false;
        await this.attemptReconnect();
        return;
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private handleEvent(event: MistralRealtimeTranscriptionEvent): void {
    switch (event.type) {
      case "transcription.text.delta":
        if (event.text) {
          this.partialText += event.text;
          this.config.onPartial?.(this.partialText);
        }
        return;
      case "transcription.segment":
        if (event.text) {
          this.config.onTranscript?.(event.text);
          this.partialText = "";
        }
        return;
      case "transcription.done":
        if (this.partialText.trim()) {
          this.config.onTranscript?.(this.partialText);
          this.partialText = "";
        }
        this.forceClose();
        return;
      case "error":
        this.config.onError?.(new Error(readErrorDetail(event)));
        return;
      default:
        return;
    }
  }

  private queueAudio(audio: Buffer): void {
    this.queuedAudio.push(Buffer.from(audio));
    this.queuedBytes += audio.byteLength;
    while (this.queuedBytes > MISTRAL_REALTIME_MAX_QUEUED_BYTES && this.queuedAudio.length > 0) {
      const dropped = this.queuedAudio.shift();
      this.queuedBytes -= dropped?.byteLength ?? 0;
    }
  }

  private flushQueuedAudio(): void {
    for (const audio of this.queuedAudio) {
      this.sendJson({
        type: "input_audio.append",
        audio: audio.toString("base64"),
      });
    }
    this.queuedAudio = [];
    this.queuedBytes = 0;
  }

  private sendJson(event: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    const payload = JSON.stringify(event);
    captureWsEvent({
      url: toMistralRealtimeWsUrl(this.config),
      direction: "outbound",
      kind: "ws-frame",
      flowId: this.flowId,
      payload,
      meta: { provider: "mistral", capability: "realtime-transcription" },
    });
    this.ws.send(payload);
  }

  private forceClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }
    this.connected = false;
    this.ready = false;
    if (this.ws) {
      this.ws.close(1000, "Transcription session closed");
      this.ws = null;
    }
  }
}

export function buildMistralRealtimeTranscriptionProvider(): RealtimeTranscriptionProviderPlugin {
  return {
    id: "mistral",
    label: "Mistral Realtime Transcription",
    aliases: ["mistral-realtime", "voxtral-realtime"],
    autoSelectOrder: 45,
    resolveConfig: ({ rawConfig }) => normalizeProviderConfig(rawConfig),
    isConfigured: ({ providerConfig }) =>
      Boolean(normalizeProviderConfig(providerConfig).apiKey || process.env.MISTRAL_API_KEY),
    createSession: (req) => {
      const config = normalizeProviderConfig(req.providerConfig);
      const apiKey = config.apiKey || process.env.MISTRAL_API_KEY;
      if (!apiKey) {
        throw new Error("Mistral API key missing");
      }
      return new MistralRealtimeTranscriptionSession({
        ...req,
        apiKey,
        baseUrl: normalizeMistralRealtimeBaseUrl(config.baseUrl),
        model: config.model ?? MISTRAL_REALTIME_DEFAULT_MODEL,
        sampleRate: config.sampleRate ?? MISTRAL_REALTIME_DEFAULT_SAMPLE_RATE,
        encoding: config.encoding ?? MISTRAL_REALTIME_DEFAULT_ENCODING,
        targetStreamingDelayMs: config.targetStreamingDelayMs ?? MISTRAL_REALTIME_DEFAULT_DELAY_MS,
      });
    },
  };
}

export const __testing = {
  normalizeProviderConfig,
  toMistralRealtimeWsUrl,
};
