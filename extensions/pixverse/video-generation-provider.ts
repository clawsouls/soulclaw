import { randomUUID } from "node:crypto";
import { extensionForMime } from "openclaw/plugin-sdk/media-mime";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import {
  assertOkOrThrowHttpError,
  createProviderOperationDeadline,
  createProviderOperationTimeoutResolver,
  fetchProviderOperationResponse,
  postJsonRequest,
  postMultipartRequest,
  resolveProviderOperationTimeoutMs,
  resolveProviderHttpRequestConfig,
  waitProviderOperationPollInterval,
  type ProviderOperationDeadline,
} from "openclaw/plugin-sdk/provider-http";
import { asFiniteNumber, normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import type {
  GeneratedVideoAsset,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationSourceAsset,
} from "openclaw/plugin-sdk/video-generation";

const PIXVERSE_BASE_URL_BY_REGION = {
  international: "https://app-api.pixverse.ai/openapi/v2",
  cn: "https://app-api.pixverseai.cn/openapi/v2",
} as const;
const DEFAULT_PIXVERSE_REGION = "international";
const DEFAULT_PIXVERSE_BASE_URL = PIXVERSE_BASE_URL_BY_REGION[DEFAULT_PIXVERSE_REGION];
const DEFAULT_PIXVERSE_MODEL = "v6";
const DEFAULT_PIXVERSE_QUALITY = "540p";
const DEFAULT_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 180;
const MAX_DURATION_SECONDS = 15;
const PIXVERSE_VIDEO_MODELS = ["v6", "c1"] as const;
const PIXVERSE_TEXT_ASPECT_RATIOS = [
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
] as const;
const PIXVERSE_QUALITIES = ["360p", "540p", "720p", "1080p"] as const;

type PixVerseApiRegion = keyof typeof PIXVERSE_BASE_URL_BY_REGION;

type PixVerseEnvelope<T> = {
  ErrCode?: unknown;
  ErrMsg?: unknown;
  Resp?: T;
};

type PixVerseUploadImageResponse = {
  img_id?: unknown;
  img_url?: unknown;
};

type PixVerseVideoCreateResponse = {
  video_id?: unknown;
};

type PixVerseVideoResultResponse = {
  id?: unknown;
  status?: unknown;
  url?: unknown;
  outputWidth?: unknown;
  outputHeight?: unknown;
  seed?: unknown;
  size?: unknown;
};

function resolvePixVerseBaseUrl(req: VideoGenerationRequest): string {
  const provider = req.cfg?.models?.providers?.pixverse;
  const configuredBaseUrl = normalizeOptionalString(provider?.baseUrl);
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }
  const region = resolvePixVerseApiRegion(provider?.region);
  return PIXVERSE_BASE_URL_BY_REGION[region];
}

function resolvePixVerseApiRegion(value: unknown): PixVerseApiRegion {
  const region = normalizeOptionalString(value)?.toLowerCase();
  switch (region) {
    case "cn":
    case "china":
    case "mainland":
    case "pai":
      return "cn";
    case "global":
    case "intl":
    case "international":
    case undefined:
      return DEFAULT_PIXVERSE_REGION;
    default:
      throw new Error(`Unsupported PixVerse API region "${region}". Use "international" or "cn".`);
  }
}

function normalizePixVerseModel(model: string | undefined): string {
  const normalized = normalizeOptionalString(model)?.replace(/^pixverse\//iu, "");
  return normalized?.toLowerCase() || DEFAULT_PIXVERSE_MODEL;
}

function resolvePixVerseQuality(req: VideoGenerationRequest): string {
  const optionQuality =
    normalizeOptionalString(req.providerOptions?.quality) ??
    normalizeOptionalString(req.resolution);
  const requested = optionQuality ?? normalizeOptionalString(req.size);
  if (!requested) {
    return DEFAULT_PIXVERSE_QUALITY;
  }
  const normalized = requested.toLowerCase() === "480p" ? "540p" : requested.toLowerCase();
  return PIXVERSE_QUALITIES.includes(normalized as (typeof PIXVERSE_QUALITIES)[number])
    ? normalized
    : DEFAULT_PIXVERSE_QUALITY;
}

function resolvePixVerseDurationSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }
  return Math.max(1, Math.min(MAX_DURATION_SECONDS, Math.round(value)));
}

function appendOptionalNumber(body: Record<string, unknown>, key: string, value: unknown): void {
  const numberValue = asFiniteNumber(value);
  if (numberValue != null) {
    body[key] = numberValue;
  }
}

function appendOptionalString(body: Record<string, unknown>, key: string, value: unknown): void {
  const stringValue = normalizeOptionalString(value);
  if (stringValue) {
    body[key] = stringValue;
  }
}

function buildHeaderEntries(apiKey: string, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "API-KEY": apiKey,
    "Ai-trace-id": randomUUID(),
  };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  return headers;
}

function buildHeaders(apiKey: string, contentType?: string): Headers {
  return new Headers(buildHeaderEntries(apiKey, contentType));
}

function readPixVerseSuccess<T>(payload: PixVerseEnvelope<T>, label: string): T {
  if (!payload || typeof payload !== "object") {
    throw new Error(`${label}: malformed JSON response`);
  }
  const code = asFiniteNumber(payload.ErrCode);
  if (code !== 0) {
    const message = normalizeOptionalString(payload.ErrMsg) ?? `ErrCode ${String(payload.ErrCode)}`;
    throw new Error(`${label}: ${message}`);
  }
  if (payload.Resp === undefined || payload.Resp === null) {
    throw new Error(`${label}: response missing Resp`);
  }
  return payload.Resp;
}

async function readPixVerseJson<T>(response: Pick<Response, "json">, label: string): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(`${label}: malformed JSON response`, { cause });
  }
  return readPixVerseSuccess(payload as PixVerseEnvelope<T>, label);
}

function readPixVerseVideoId(payload: PixVerseVideoCreateResponse): number {
  const videoId = asFiniteNumber(payload.video_id);
  if (videoId == null) {
    throw new Error("PixVerse video generation response missing video_id");
  }
  return videoId;
}

function readPixVerseImageId(payload: PixVerseUploadImageResponse): number {
  const imageId = asFiniteNumber(payload.img_id);
  if (imageId == null) {
    throw new Error("PixVerse image upload response missing img_id");
  }
  return imageId;
}

function readPixVerseStatus(payload: PixVerseVideoResultResponse): number {
  const status = asFiniteNumber(payload.status);
  if (status == null) {
    throw new Error("PixVerse video status response missing status");
  }
  return status;
}

function buildUploadImageForm(asset: VideoGenerationSourceAsset): FormData {
  const form = new FormData();
  const url = normalizeOptionalString(asset.url);
  if (url) {
    form.set("image_url", url);
    return form;
  }
  if (!asset.buffer) {
    throw new Error("PixVerse image-to-video input is missing image data.");
  }
  const mimeType = normalizeOptionalString(asset.mimeType) ?? "image/png";
  const extension = extensionForMime(mimeType)?.slice(1) ?? "png";
  const fileName = normalizeOptionalString(asset.fileName) ?? `image.${extension}`;
  const bytes = new Uint8Array(asset.buffer.byteLength);
  bytes.set(asset.buffer);
  form.set("image", new File([bytes], fileName, { type: mimeType }));
  return form;
}

function buildVideoBody(
  req: VideoGenerationRequest,
  model: string,
  imageId?: number,
): Record<string, unknown> {
  const options = req.providerOptions ?? {};
  const body: Record<string, unknown> = {
    duration: resolvePixVerseDurationSeconds(req.durationSeconds),
    model,
    prompt: req.prompt,
    quality: resolvePixVerseQuality(req),
  };
  if (imageId !== undefined) {
    body.img_id = imageId;
    body.motion_mode =
      normalizeOptionalString(options.motion_mode) ??
      normalizeOptionalString(options.motionMode) ??
      "normal";
  } else {
    body.aspect_ratio = normalizeOptionalString(req.aspectRatio) ?? "16:9";
  }
  appendOptionalString(
    body,
    "negative_prompt",
    normalizeOptionalString(options.negative_prompt) ??
      normalizeOptionalString(options.negativePrompt),
  );
  appendOptionalString(
    body,
    "camera_movement",
    normalizeOptionalString(options.camera_movement) ??
      normalizeOptionalString(options.cameraMovement),
  );
  appendOptionalNumber(
    body,
    "template_id",
    asFiniteNumber(options.template_id) ?? asFiniteNumber(options.templateId),
  );
  appendOptionalNumber(body, "seed", options.seed);
  if (req.audio !== undefined) {
    body.generate_audio_switch = req.audio;
  }
  return body;
}

function readPixVerseFailureMessage(payload: PixVerseVideoResultResponse): string | undefined {
  switch (readPixVerseStatus(payload)) {
    case 7:
      return "PixVerse video generation failed content moderation";
    case 8:
      return "PixVerse video generation failed";
    case 6:
      return "PixVerse video generation was deleted before completion";
    default:
      return undefined;
  }
}

async function pollPixVerseVideo(params: {
  videoId: number;
  apiKey: string;
  baseUrl: string;
  deadline: ProviderOperationDeadline;
  fetchFn: typeof fetch;
}): Promise<PixVerseVideoResultResponse> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const response = await fetchProviderOperationResponse({
      stage: "poll",
      url: `${params.baseUrl}/video/result/${params.videoId}`,
      init: {
        method: "GET",
        headers: buildHeaders(params.apiKey),
      },
      timeoutMs: createProviderOperationTimeoutResolver({
        deadline: params.deadline,
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      }),
      fetchFn: params.fetchFn,
      provider: "pixverse",
      requestFailedMessage: "PixVerse video status request failed",
    });
    const payload = await readPixVerseJson<PixVerseVideoResultResponse>(
      response,
      "PixVerse video status request failed",
    );
    if (readPixVerseStatus(payload) === 1) {
      return payload;
    }
    const failureMessage = readPixVerseFailureMessage(payload);
    if (failureMessage) {
      throw new Error(failureMessage);
    }
    await waitProviderOperationPollInterval({
      deadline: params.deadline,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
  }
  throw new Error(`PixVerse video generation task ${params.videoId} did not finish in time`);
}

function extractPixVerseVideo(payload: PixVerseVideoResultResponse): GeneratedVideoAsset {
  const url = normalizeOptionalString(payload.url);
  if (!url) {
    throw new Error("PixVerse video generation completed without output URL");
  }
  return {
    url,
    mimeType: "video/mp4",
    fileName: "video-1.mp4",
    metadata: {
      sourceUrl: url,
      outputWidth: asFiniteNumber(payload.outputWidth),
      outputHeight: asFiniteNumber(payload.outputHeight),
    },
  };
}

export function buildPixVerseVideoGenerationProvider(): VideoGenerationProvider {
  return {
    id: "pixverse",
    label: "PixVerse",
    defaultModel: DEFAULT_PIXVERSE_MODEL,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    models: [...PIXVERSE_VIDEO_MODELS],
    isConfigured: ({ agentDir }) =>
      isProviderApiKeyConfigured({
        provider: "pixverse",
        agentDir,
      }),
    capabilities: {
      generate: {
        maxVideos: 1,
        maxDurationSeconds: MAX_DURATION_SECONDS,
        supportedDurationSeconds: Array.from(
          { length: MAX_DURATION_SECONDS },
          (_, index) => index + 1,
        ),
        aspectRatios: [...PIXVERSE_TEXT_ASPECT_RATIOS],
        resolutions: ["360P", "540P", "720P", "1080P"],
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsAudio: true,
        providerOptions: {
          seed: "number",
          negative_prompt: "string",
          negativePrompt: "string",
          quality: "string",
          camera_movement: "string",
          cameraMovement: "string",
          template_id: "number",
          templateId: "number",
        },
      },
      imageToVideo: {
        enabled: true,
        maxVideos: 1,
        maxInputImages: 1,
        maxDurationSeconds: MAX_DURATION_SECONDS,
        supportedDurationSeconds: Array.from(
          { length: MAX_DURATION_SECONDS },
          (_, index) => index + 1,
        ),
        resolutions: ["360P", "540P", "720P", "1080P"],
        supportsResolution: true,
        supportsAudio: true,
        providerOptions: {
          seed: "number",
          negative_prompt: "string",
          negativePrompt: "string",
          quality: "string",
          motion_mode: "string",
          motionMode: "string",
          camera_movement: "string",
          cameraMovement: "string",
          template_id: "number",
          templateId: "number",
        },
      },
      videoToVideo: {
        enabled: false,
      },
    },
    async generateVideo(req) {
      if ((req.inputVideos?.length ?? 0) > 0) {
        throw new Error("PixVerse video generation does not support video reference inputs.");
      }
      if ((req.inputImages?.length ?? 0) > 1) {
        throw new Error("PixVerse image-to-video supports at most one input image.");
      }

      const auth = await resolveApiKeyForProvider({
        provider: "pixverse",
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("PixVerse API key missing");
      }

      const model = normalizePixVerseModel(req.model);
      const fetchFn = fetch;
      const deadline = createProviderOperationDeadline({
        timeoutMs: req.timeoutMs,
        label: "PixVerse video generation",
      });
      const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy } =
        resolveProviderHttpRequestConfig({
          baseUrl: resolvePixVerseBaseUrl(req),
          defaultBaseUrl: DEFAULT_PIXVERSE_BASE_URL,
          defaultHeaders: buildHeaderEntries(auth.apiKey, "application/json"),
          provider: "pixverse",
          capability: "video",
          transport: "http",
        });

      const image = req.inputImages?.[0];
      let imageId: number | undefined;
      if (image) {
        const upload = await postMultipartRequest({
          url: `${baseUrl}/image/upload`,
          headers: buildHeaders(auth.apiKey),
          body: buildUploadImageForm(image),
          timeoutMs: resolveProviderOperationTimeoutMs({
            deadline,
            defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
          }),
          fetchFn,
          allowPrivateNetwork,
          dispatcherPolicy,
        });
        try {
          await assertOkOrThrowHttpError(upload.response, "PixVerse image upload failed");
          imageId = readPixVerseImageId(
            await readPixVerseJson<PixVerseUploadImageResponse>(
              upload.response,
              "PixVerse image upload failed",
            ),
          );
        } finally {
          await upload.release();
        }
      }

      const endpoint = imageId === undefined ? "/video/text/generate" : "/video/img/generate";
      const create = await postJsonRequest({
        url: `${baseUrl}${endpoint}`,
        headers,
        body: buildVideoBody(req, model, imageId),
        timeoutMs: resolveProviderOperationTimeoutMs({
          deadline,
          defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        }),
        fetchFn,
        allowPrivateNetwork,
        dispatcherPolicy,
      });
      try {
        await assertOkOrThrowHttpError(create.response, "PixVerse video generation failed");
        const videoId = readPixVerseVideoId(
          await readPixVerseJson<PixVerseVideoCreateResponse>(
            create.response,
            "PixVerse video generation failed",
          ),
        );
        const completed = await pollPixVerseVideo({
          videoId,
          apiKey: auth.apiKey,
          baseUrl,
          deadline,
          fetchFn,
        });
        return {
          videos: [extractPixVerseVideo(completed)],
          model,
          metadata: {
            endpoint,
            videoId,
            status: readPixVerseStatus(completed),
            seed: asFiniteNumber(completed.seed),
            size: asFiniteNumber(completed.size),
          },
        };
      } finally {
        await create.release();
      }
    },
  };
}
