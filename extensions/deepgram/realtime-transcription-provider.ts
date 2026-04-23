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
import { DEFAULT_DEEPGRAM_AUDIO_BASE_URL, DEFAULT_DEEPGRAM_AUDIO_MODEL } from "./audio.js";

type DeepgramRealtimeTranscriptionEncoding = "linear16" | "mulaw" | "alaw";

type DeepgramRealtimeTranscriptionProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  language?: string;
  sampleRate?: number;
  encoding?: DeepgramRealtimeTranscriptionEncoding;
  interimResults?: boolean;
  endpointingMs?: number;
};

type DeepgramRealtimeTranscriptionSessionConfig = RealtimeTranscriptionSessionCreateRequest & {
  apiKey: string;
  baseUrl: string;
  model: string;
  sampleRate: number;
  encoding: DeepgramRealtimeTranscriptionEncoding;
  interimResults: boolean;
  endpointingMs: number;
  language?: string;
};

type DeepgramRealtimeTranscriptionEvent = {
  type?: string;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
  error?: unknown;
  message?: string;
};

const DEEPGRAM_REALTIME_DEFAULT_SAMPLE_RATE = 8000;
const DEEPGRAM_REALTIME_DEFAULT_ENCODING: DeepgramRealtimeTranscriptionEncoding = "mulaw";
const DEEPGRAM_REALTIME_DEFAULT_ENDPOINTING_MS = 800;
const DEEPGRAM_REALTIME_CONNECT_TIMEOUT_MS = 10_000;
const DEEPGRAM_REALTIME_CLOSE_TIMEOUT_MS = 5_000;
const DEEPGRAM_REALTIME_MAX_RECONNECT_ATTEMPTS = 5;
const DEEPGRAM_REALTIME_RECONNECT_DELAY_MS = 1000;
const DEEPGRAM_REALTIME_MAX_QUEUED_BYTES = 2 * 1024 * 1024;

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNestedDeepgramConfig(rawConfig: RealtimeTranscriptionProviderConfig) {
  const raw = readRecord(rawConfig);
  const providers = readRecord(raw?.providers);
  return readRecord(providers?.deepgram ?? raw?.deepgram ?? raw) ?? {};
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

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function normalizeDeepgramEncoding(
  value: unknown,
): DeepgramRealtimeTranscriptionEncoding | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "pcm" || normalized === "pcm_s16le" || normalized === "linear16") {
    return "linear16";
  }
  if (normalized === "ulaw" || normalized === "g711_ulaw" || normalized === "g711-mulaw") {
    return "mulaw";
  }
  if (normalized === "g711_alaw" || normalized === "g711-alaw") {
    return "alaw";
  }
  if (normalized === "mulaw" || normalized === "alaw") {
    return normalized;
  }
  throw new Error(`Invalid Deepgram realtime transcription encoding: ${normalized}`);
}

function normalizeDeepgramRealtimeBaseUrl(value?: string): string {
  return (
    normalizeOptionalString(value ?? process.env.DEEPGRAM_BASE_URL) ??
    DEFAULT_DEEPGRAM_AUDIO_BASE_URL
  );
}

function toDeepgramRealtimeWsUrl(config: DeepgramRealtimeTranscriptionSessionConfig): string {
  const url = new URL(normalizeDeepgramRealtimeBaseUrl(config.baseUrl));
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/listen`;
  url.searchParams.set("model", config.model);
  url.searchParams.set("encoding", config.encoding);
  url.searchParams.set("sample_rate", String(config.sampleRate));
  url.searchParams.set("channels", "1");
  url.searchParams.set("interim_results", String(config.interimResults));
  url.searchParams.set("endpointing", String(config.endpointingMs));
  if (config.language) {
    url.searchParams.set("language", config.language);
  }
  return url.toString();
}

function normalizeProviderConfig(
  config: RealtimeTranscriptionProviderConfig,
): DeepgramRealtimeTranscriptionProviderConfig {
  const raw = readNestedDeepgramConfig(config);
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw.apiKey,
      path: "plugins.entries.voice-call.config.streaming.providers.deepgram.apiKey",
    }),
    baseUrl: normalizeOptionalString(raw.baseUrl),
    model: normalizeOptionalString(raw.model ?? raw.sttModel),
    language: normalizeOptionalString(raw.language),
    sampleRate: readFiniteNumber(raw.sampleRate ?? raw.sample_rate),
    encoding: normalizeDeepgramEncoding(raw.encoding),
    interimResults: readBoolean(raw.interimResults ?? raw.interim_results),
    endpointingMs: readFiniteNumber(raw.endpointingMs ?? raw.endpointing ?? raw.silenceDurationMs),
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

function readErrorDetail(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const record = readRecord(value);
  const message = normalizeOptionalString(record?.message);
  const code = normalizeOptionalString(record?.code);
  return message ?? code ?? "Deepgram realtime transcription error";
}

function readTranscriptText(event: DeepgramRealtimeTranscriptionEvent): string | undefined {
  return normalizeOptionalString(event.channel?.alternatives?.[0]?.transcript);
}

class DeepgramRealtimeTranscriptionSession implements RealtimeTranscriptionSession {
  private ws: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private reconnectAttempts = 0;
  private queuedAudio: Buffer[] = [];
  private queuedBytes = 0;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTranscript: string | undefined;
  private speechStarted = false;
  private reconnecting = false;
  private readonly flowId = randomUUID();

  constructor(private readonly config: DeepgramRealtimeTranscriptionSessionConfig) {}

  async connect(): Promise<void> {
    this.closed = false;
    this.reconnectAttempts = 0;
    await this.doConnect();
  }

  sendAudio(audio: Buffer): void {
    if (this.closed || audio.byteLength === 0) {
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendAudioFrame(audio);
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
    this.sendEvent({ type: "Finalize" });
    this.closeTimer = setTimeout(() => this.forceClose(), DEEPGRAM_REALTIME_CLOSE_TIMEOUT_MS);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async doConnect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const url = toDeepgramRealtimeWsUrl(this.config);
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
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
        },
        ...(proxyAgent ? { agent: proxyAgent } : {}),
      });

      const connectTimeout = setTimeout(() => {
        failConnect(new Error("Deepgram realtime transcription connection timeout"));
      }, DEEPGRAM_REALTIME_CONNECT_TIMEOUT_MS);

      this.ws.on("open", () => {
        opened = true;
        this.connected = true;
        this.reconnectAttempts = 0;
        captureWsEvent({
          url,
          direction: "local",
          kind: "ws-open",
          flowId: this.flowId,
          meta: { provider: "deepgram", capability: "realtime-transcription" },
        });
        finishConnect();
      });

      this.ws.on("message", (data) => {
        const payload = rawWsDataToBuffer(data);
        captureWsEvent({
          url,
          direction: "inbound",
          kind: "ws-frame",
          flowId: this.flowId,
          payload,
          meta: { provider: "deepgram", capability: "realtime-transcription" },
        });
        try {
          this.handleEvent(JSON.parse(payload.toString()) as DeepgramRealtimeTranscriptionEvent);
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
          meta: { provider: "deepgram", capability: "realtime-transcription" },
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
    if (this.reconnectAttempts >= DEEPGRAM_REALTIME_MAX_RECONNECT_ATTEMPTS) {
      this.config.onError?.(new Error("Deepgram realtime transcription reconnect limit reached"));
      return;
    }
    this.reconnectAttempts += 1;
    const delay = DEEPGRAM_REALTIME_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
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

  private handleEvent(event: DeepgramRealtimeTranscriptionEvent): void {
    switch (event.type) {
      case "Results": {
        const text = readTranscriptText(event);
        if (!text) {
          return;
        }
        if (!this.speechStarted) {
          this.speechStarted = true;
          this.config.onSpeechStart?.();
        }
        if (event.is_final || event.speech_final) {
          this.emitTranscript(text);
          if (event.speech_final) {
            this.speechStarted = false;
          }
          return;
        }
        this.config.onPartial?.(text);
        return;
      }
      case "SpeechStarted":
        this.speechStarted = true;
        this.config.onSpeechStart?.();
        return;
      case "Error":
      case "error":
        this.config.onError?.(new Error(readErrorDetail(event.error ?? event.message)));
        return;
      default:
        return;
    }
  }

  private emitTranscript(text: string): void {
    if (text === this.lastTranscript) {
      return;
    }
    this.lastTranscript = text;
    this.config.onTranscript?.(text);
  }

  private queueAudio(audio: Buffer): void {
    this.queuedAudio.push(Buffer.from(audio));
    this.queuedBytes += audio.byteLength;
    while (this.queuedBytes > DEEPGRAM_REALTIME_MAX_QUEUED_BYTES && this.queuedAudio.length > 0) {
      const dropped = this.queuedAudio.shift();
      this.queuedBytes -= dropped?.byteLength ?? 0;
    }
  }

  private flushQueuedAudio(): void {
    for (const audio of this.queuedAudio) {
      this.sendAudioFrame(audio);
    }
    this.queuedAudio = [];
    this.queuedBytes = 0;
  }

  private sendAudioFrame(audio: Buffer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.queueAudio(audio);
      return;
    }
    captureWsEvent({
      url: toDeepgramRealtimeWsUrl(this.config),
      direction: "outbound",
      kind: "ws-frame",
      flowId: this.flowId,
      payload: audio,
      meta: { provider: "deepgram", capability: "realtime-transcription" },
    });
    this.ws.send(audio);
  }

  private sendEvent(event: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    const payload = JSON.stringify(event);
    captureWsEvent({
      url: toDeepgramRealtimeWsUrl(this.config),
      direction: "outbound",
      kind: "ws-frame",
      flowId: this.flowId,
      payload,
      meta: { provider: "deepgram", capability: "realtime-transcription" },
    });
    this.ws.send(payload);
  }

  private forceClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }
    this.connected = false;
    if (this.ws) {
      this.ws.close(1000, "Transcription session closed");
      this.ws = null;
    }
  }
}

export function buildDeepgramRealtimeTranscriptionProvider(): RealtimeTranscriptionProviderPlugin {
  return {
    id: "deepgram",
    label: "Deepgram Realtime Transcription",
    aliases: ["deepgram-realtime", "nova-3-streaming"],
    autoSelectOrder: 35,
    resolveConfig: ({ rawConfig }) => normalizeProviderConfig(rawConfig),
    isConfigured: ({ providerConfig }) =>
      Boolean(normalizeProviderConfig(providerConfig).apiKey || process.env.DEEPGRAM_API_KEY),
    createSession: (req) => {
      const config = normalizeProviderConfig(req.providerConfig);
      const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        throw new Error("Deepgram API key missing");
      }
      return new DeepgramRealtimeTranscriptionSession({
        ...req,
        apiKey,
        baseUrl: normalizeDeepgramRealtimeBaseUrl(config.baseUrl),
        model: config.model ?? DEFAULT_DEEPGRAM_AUDIO_MODEL,
        sampleRate: config.sampleRate ?? DEEPGRAM_REALTIME_DEFAULT_SAMPLE_RATE,
        encoding: config.encoding ?? DEEPGRAM_REALTIME_DEFAULT_ENCODING,
        interimResults: config.interimResults ?? true,
        endpointingMs: config.endpointingMs ?? DEEPGRAM_REALTIME_DEFAULT_ENDPOINTING_MS,
        language: config.language,
      });
    },
  };
}

export const __testing = {
  normalizeProviderConfig,
  toDeepgramRealtimeWsUrl,
};
