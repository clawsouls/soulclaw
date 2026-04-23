import type { Api, AssistantMessage, Context, Model } from "@mariozechner/pi-ai";

export const LIVE_MODEL_FILE_PROBE_TOKEN = "OPAL_731";

export const LIVE_MODEL_FILE_PROBE_ENV = "OPENCLAW_LIVE_MODEL_FILE_PROBE";
export const LIVE_MODEL_IMAGE_PROBE_ENV = "OPENCLAW_LIVE_MODEL_IMAGE_PROBE";

const PROBE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALklEQVR4nO3OoQEAAAyDsP7/9HYGJgJNdtuVDQAAAAAAACAHxH8AAAAAAACAHvBX0fhq85dN7QAAAABJRU5ErkJggg==";

export function isLiveModelProbeEnabled(
  env: Record<string, string | undefined>,
  key: string,
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw);
}

export function extractAssistantText(message: Pick<AssistantMessage, "content">): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(" ");
}

export function modelSupportsImageInput(model: Pick<Model<Api>, "input">): boolean {
  return model.input.includes("image");
}

export function buildLiveModelFileProbeContext(params: { systemPrompt?: string }): Context {
  return {
    systemPrompt: params.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Read this file excerpt and reply with only the value after LIVE_FILE_TOKEN.\n\n" +
              '<file path="live-model-probe.txt" mime="text/plain">\n' +
              `LIVE_FILE_TOKEN=${LIVE_MODEL_FILE_PROBE_TOKEN}\n` +
              "</file>",
          },
        ],
        timestamp: Date.now(),
      },
    ],
  };
}

export function buildLiveModelImageProbeContext(params: { systemPrompt?: string }): Context {
  return {
    systemPrompt: params.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Reply with exactly the word OK if you received this image.",
          },
          {
            type: "image",
            data: PROBE_PNG_BASE64,
            mimeType: "image/png",
          },
        ],
        timestamp: Date.now(),
      },
    ],
  };
}

export function fileProbeTextMatches(text: string): boolean {
  return text.toUpperCase().includes(LIVE_MODEL_FILE_PROBE_TOKEN);
}

export function imageProbeTextMatches(text: string): boolean {
  return /\bok\b/i.test(text);
}
