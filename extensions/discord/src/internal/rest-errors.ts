export function readDiscordCode(body: unknown): number | undefined {
  const value =
    body && typeof body === "object" && "code" in body
      ? (body as { code?: unknown }).code
      : undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

const RETRY_AFTER_HEADER_DELAY_RE = /^\d+$/;
const RETRY_AFTER_BODY_SECONDS_RE = /^(?:\d+\.?\d*|\.\d+)$/;

export function readDiscordMessage(body: unknown, fallback: string): string {
  const value =
    body && typeof body === "object" && "message" in body
      ? (body as { message?: unknown }).message
      : undefined;
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readRetryAfterHeader(value: string | null, now = Date.now()): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (RETRY_AFTER_HEADER_DELAY_RE.test(trimmed)) {
    return Number(trimmed);
  }
  const retryAt = Date.parse(trimmed);
  return Number.isFinite(retryAt) ? (retryAt - now) / 1000 : undefined;
}

function coerceRetryAfterSeconds(value: unknown): number | undefined {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && RETRY_AFTER_BODY_SECONDS_RE.test(value.trim())
        ? Number(value.trim())
        : undefined;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(0, seconds) : undefined;
}

export function readRetryAfter(body: unknown, response: Response, fallbackSeconds = 0): number {
  const bodyValue =
    body && typeof body === "object" && "retry_after" in body
      ? (body as { retry_after?: unknown }).retry_after
      : undefined;
  return (
    coerceRetryAfterSeconds(bodyValue) ??
    coerceRetryAfterSeconds(readRetryAfterHeader(response.headers.get("Retry-After"))) ??
    fallbackSeconds
  );
}

export class DiscordError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly rawBody: unknown;
  readonly rawError: unknown;
  discordCode?: number;

  constructor(response: Response, body: unknown) {
    super(readDiscordMessage(body, `Discord API request failed (${response.status})`));
    this.name = "DiscordError";
    this.status = response.status;
    this.statusCode = response.status;
    this.rawBody = body;
    this.rawError = body;
    this.discordCode = readDiscordCode(body);
  }
}

export class RateLimitError extends DiscordError {
  readonly retryAfter: number;
  readonly scope: string | null;
  readonly bucket: string | null;

  constructor(
    response: Response,
    body: { message: string; retry_after: number; global: boolean; code?: number | string },
  ) {
    super(response, body);
    this.name = "RateLimitError";
    this.retryAfter = readRetryAfter(body, response, 1);
    this.scope = body.global ? "global" : response.headers.get("X-RateLimit-Scope");
    this.bucket = response.headers.get("X-RateLimit-Bucket");
  }
}
