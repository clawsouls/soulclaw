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
import { resolveElevenLabsApiKeyWithProfileFallback } from "./config-api.js";
import { normalizeElevenLabsBaseUrl } from "./shared.js";

type ElevenLabsRealtimeTranscriptionProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  audioFormat?: string;
  sampleRate?: number;
  languageCode?: string;
  commitStrategy?: "manual" | "vad";
  vadSilenceThresholdSecs?: number;
  vadThreshold?: number;
  minSpeechDurationMs?: number;
  minSilenceDurationMs?: number;
};

type ElevenLabsRealtimeTranscriptionSessionConfig = RealtimeTranscriptionSessionCreateRequest & {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  audioFormat: string;
  sampleRate: number;
  commitStrategy: "manual" | "vad";
  languageCode?: string;
  vadSilenceThresholdSecs?: number;
  vadThreshold?: number;
  minSpeechDurationMs?: number;
  minSilenceDurationMs?: number;
};

type ElevenLabsRealtimeTranscriptionEvent = {
  message_type?: string;
  text?: string;
  error?: string;
  message?: string;
  code?: string;
};

const ELEVENLABS_REALTIME_DEFAULT_MODEL = "scribe_v2_realtime";
const ELEVENLABS_REALTIME_DEFAULT_AUDIO_FORMAT = "ulaw_8000";
const ELEVENLABS_REALTIME_DEFAULT_SAMPLE_RATE = 8000;
const ELEVENLABS_REALTIME_DEFAULT_COMMIT_STRATEGY: "manual" | "vad" = "vad";
const ELEVENLABS_REALTIME_CONNECT_TIMEOUT_MS = 10_000;
const ELEVENLABS_REALTIME_CLOSE_TIMEOUT_MS = 5_000;
const ELEVENLABS_REALTIME_MAX_RECONNECT_ATTEMPTS = 5;
const ELEVENLABS_REALTIME_RECONNECT_DELAY_MS = 1000;
const ELEVENLABS_REALTIME_MAX_QUEUED_BYTES = 2 * 1024 * 1024;

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNestedElevenLabsConfig(rawConfig: RealtimeTranscriptionProviderConfig) {
  const raw = readRecord(rawConfig);
  const providers = readRecord(raw?.providers);
  return readRecord(providers?.elevenlabs ?? raw?.elevenlabs ?? raw) ?? {};
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

function normalizeCommitStrategy(value: unknown): "manual" | "vad" | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "manual" || normalized === "vad") {
    return normalized;
  }
  throw new Error(`Invalid ElevenLabs realtime transcription commit strategy: ${normalized}`);
}

function normalizeProviderConfig(
  config: RealtimeTranscriptionProviderConfig,
): ElevenLabsRealtimeTranscriptionProviderConfig {
  const raw = readNestedElevenLabsConfig(config);
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw.apiKey,
      path: "plugins.entries.voice-call.config.streaming.providers.elevenlabs.apiKey",
    }),
    baseUrl: normalizeOptionalString(raw.baseUrl),
    modelId: normalizeOptionalString(raw.modelId ?? raw.model ?? raw.sttModel),
    audioFormat: normalizeOptionalString(raw.audioFormat ?? raw.audio_format ?? raw.encoding),
    sampleRate: readFiniteNumber(raw.sampleRate ?? raw.sample_rate),
    languageCode: normalizeOptionalString(raw.languageCode ?? raw.language),
    commitStrategy: normalizeCommitStrategy(raw.commitStrategy ?? raw.commit_strategy),
    vadSilenceThresholdSecs: readFiniteNumber(
      raw.vadSilenceThresholdSecs ?? raw.vad_silence_threshold_secs,
    ),
    vadThreshold: readFiniteNumber(raw.vadThreshold ?? raw.vad_threshold),
    minSpeechDurationMs: readFiniteNumber(raw.minSpeechDurationMs ?? raw.min_speech_duration_ms),
    minSilenceDurationMs: readFiniteNumber(raw.minSilenceDurationMs ?? raw.min_silence_duration_ms),
  };
}

function normalizeElevenLabsRealtimeBaseUrl(value?: string): string {
  const url = new URL(normalizeElevenLabsBaseUrl(value));
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url.toString().replace(/\/+$/, "");
}

function toElevenLabsRealtimeWsUrl(config: ElevenLabsRealtimeTranscriptionSessionConfig): string {
  const url = new URL(
    `${normalizeElevenLabsRealtimeBaseUrl(config.baseUrl)}/v1/speech-to-text/realtime`,
  );
  url.searchParams.set("model_id", config.modelId);
  url.searchParams.set("audio_format", config.audioFormat);
  url.searchParams.set("commit_strategy", config.commitStrategy);
  url.searchParams.set("include_timestamps", "false");
  url.searchParams.set("include_language_detection", "false");
  if (config.languageCode) {
    url.searchParams.set("language_code", config.languageCode);
  }
  if (config.vadSilenceThresholdSecs != null) {
    url.searchParams.set("vad_silence_threshold_secs", String(config.vadSilenceThresholdSecs));
  }
  if (config.vadThreshold != null) {
    url.searchParams.set("vad_threshold", String(config.vadThreshold));
  }
  if (config.minSpeechDurationMs != null) {
    url.searchParams.set("min_speech_duration_ms", String(config.minSpeechDurationMs));
  }
  if (config.minSilenceDurationMs != null) {
    url.searchParams.set("min_silence_duration_ms", String(config.minSilenceDurationMs));
  }
  return url.toString();
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

function readErrorDetail(event: ElevenLabsRealtimeTranscriptionEvent): string {
  return (
    normalizeOptionalString(event.error) ??
    normalizeOptionalString(event.message) ??
    normalizeOptionalString(event.code) ??
    "ElevenLabs realtime transcription error"
  );
}

class ElevenLabsRealtimeTranscriptionSession implements RealtimeTranscriptionSession {
  private ws: WebSocket | null = null;
  private connected = false;
  private ready = false;
  private closed = false;
  private reconnectAttempts = 0;
  private queuedAudio: Buffer[] = [];
  private queuedBytes = 0;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTranscript: string | undefined;
  private reconnecting = false;
  private readonly flowId = randomUUID();

  constructor(private readonly config: ElevenLabsRealtimeTranscriptionSessionConfig) {}

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
      this.sendAudioChunk(audio);
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
    this.sendJson({
      message_type: "input_audio_chunk",
      audio_base_64: "",
      sample_rate: this.config.sampleRate,
      commit: true,
    });
    this.closeTimer = setTimeout(() => this.forceClose(), ELEVENLABS_REALTIME_CLOSE_TIMEOUT_MS);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async doConnect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const url = toElevenLabsRealtimeWsUrl(this.config);
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
          "xi-api-key": this.config.apiKey,
        },
        ...(proxyAgent ? { agent: proxyAgent } : {}),
      });

      const connectTimeout = setTimeout(() => {
        failConnect(new Error("ElevenLabs realtime transcription connection timeout"));
      }, ELEVENLABS_REALTIME_CONNECT_TIMEOUT_MS);

      this.ws.on("open", () => {
        opened = true;
        this.connected = true;
        this.reconnectAttempts = 0;
        captureWsEvent({
          url,
          direction: "local",
          kind: "ws-open",
          flowId: this.flowId,
          meta: { provider: "elevenlabs", capability: "realtime-transcription" },
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
          meta: { provider: "elevenlabs", capability: "realtime-transcription" },
        });
        try {
          const event = JSON.parse(payload.toString()) as ElevenLabsRealtimeTranscriptionEvent;
          if (event.message_type === "session_started") {
            finishConnect();
            return;
          }
          if (!this.ready && event.message_type?.includes("error")) {
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
          meta: { provider: "elevenlabs", capability: "realtime-transcription" },
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
    if (this.reconnectAttempts >= ELEVENLABS_REALTIME_MAX_RECONNECT_ATTEMPTS) {
      this.config.onError?.(new Error("ElevenLabs realtime transcription reconnect limit reached"));
      return;
    }
    this.reconnectAttempts += 1;
    const delay = ELEVENLABS_REALTIME_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
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

  private handleEvent(event: ElevenLabsRealtimeTranscriptionEvent): void {
    switch (event.message_type) {
      case "partial_transcript":
        if (event.text) {
          this.config.onPartial?.(event.text);
        }
        return;
      case "committed_transcript":
      case "committed_transcript_with_timestamps":
        if (event.text) {
          this.emitTranscript(event.text);
        }
        return;
      default:
        if (event.message_type?.includes("error")) {
          this.config.onError?.(new Error(readErrorDetail(event)));
        }
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
    while (this.queuedBytes > ELEVENLABS_REALTIME_MAX_QUEUED_BYTES && this.queuedAudio.length > 0) {
      const dropped = this.queuedAudio.shift();
      this.queuedBytes -= dropped?.byteLength ?? 0;
    }
  }

  private flushQueuedAudio(): void {
    for (const audio of this.queuedAudio) {
      this.sendAudioChunk(audio);
    }
    this.queuedAudio = [];
    this.queuedBytes = 0;
  }

  private sendAudioChunk(audio: Buffer): void {
    this.sendJson({
      message_type: "input_audio_chunk",
      audio_base_64: audio.toString("base64"),
      sample_rate: this.config.sampleRate,
      ...(this.config.commitStrategy === "manual" ? { commit: true } : {}),
    });
  }

  private sendJson(event: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    const payload = JSON.stringify(event);
    captureWsEvent({
      url: toElevenLabsRealtimeWsUrl(this.config),
      direction: "outbound",
      kind: "ws-frame",
      flowId: this.flowId,
      payload,
      meta: { provider: "elevenlabs", capability: "realtime-transcription" },
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

export function buildElevenLabsRealtimeTranscriptionProvider(): RealtimeTranscriptionProviderPlugin {
  return {
    id: "elevenlabs",
    label: "ElevenLabs Realtime Transcription",
    aliases: ["elevenlabs-realtime", "scribe-v2-realtime"],
    autoSelectOrder: 40,
    resolveConfig: ({ rawConfig }) => normalizeProviderConfig(rawConfig),
    isConfigured: ({ providerConfig }) =>
      Boolean(
        normalizeProviderConfig(providerConfig).apiKey ||
        resolveElevenLabsApiKeyWithProfileFallback() ||
        process.env.XI_API_KEY,
      ),
    createSession: (req) => {
      const config = normalizeProviderConfig(req.providerConfig);
      const apiKey =
        config.apiKey || resolveElevenLabsApiKeyWithProfileFallback() || process.env.XI_API_KEY;
      if (!apiKey) {
        throw new Error("ElevenLabs API key missing");
      }
      return new ElevenLabsRealtimeTranscriptionSession({
        ...req,
        apiKey,
        baseUrl: normalizeElevenLabsBaseUrl(config.baseUrl),
        modelId: config.modelId ?? ELEVENLABS_REALTIME_DEFAULT_MODEL,
        audioFormat: config.audioFormat ?? ELEVENLABS_REALTIME_DEFAULT_AUDIO_FORMAT,
        sampleRate: config.sampleRate ?? ELEVENLABS_REALTIME_DEFAULT_SAMPLE_RATE,
        commitStrategy: config.commitStrategy ?? ELEVENLABS_REALTIME_DEFAULT_COMMIT_STRATEGY,
        languageCode: config.languageCode,
        vadSilenceThresholdSecs: config.vadSilenceThresholdSecs,
        vadThreshold: config.vadThreshold,
        minSpeechDurationMs: config.minSpeechDurationMs,
        minSilenceDurationMs: config.minSilenceDurationMs,
      });
    },
  };
}

export const __testing = {
  normalizeProviderConfig,
  toElevenLabsRealtimeWsUrl,
};
