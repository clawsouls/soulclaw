import { describe, expect, it } from "vitest";
import {
  buildLiveModelFileProbeContext,
  buildLiveModelImageProbeContext,
  extractAssistantText,
  fileProbeTextMatches,
  imageProbeTextMatches,
  isLiveModelProbeEnabled,
  LIVE_MODEL_FILE_PROBE_TOKEN,
  modelSupportsImageInput,
} from "./live-model-turn-probes.js";

describe("live model turn probes", () => {
  it("defaults probes on and accepts common opt-out values", () => {
    expect(isLiveModelProbeEnabled({}, "OPENCLAW_LIVE_MODEL_IMAGE_PROBE")).toBe(true);
    expect(
      isLiveModelProbeEnabled(
        { OPENCLAW_LIVE_MODEL_IMAGE_PROBE: "false" },
        "OPENCLAW_LIVE_MODEL_IMAGE_PROBE",
      ),
    ).toBe(false);
    expect(
      isLiveModelProbeEnabled(
        { OPENCLAW_LIVE_MODEL_IMAGE_PROBE: "1" },
        "OPENCLAW_LIVE_MODEL_IMAGE_PROBE",
      ),
    ).toBe(true);
  });

  it("builds a text-block file read probe", () => {
    const context = buildLiveModelFileProbeContext({ systemPrompt: "sys" });
    expect(context.systemPrompt).toBe("sys");
    expect(context.messages[0]?.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining(`LIVE_FILE_TOKEN=${LIVE_MODEL_FILE_PROBE_TOKEN}`),
      }),
    ]);
  });

  it("builds an image probe with native image content", () => {
    const context = buildLiveModelImageProbeContext({});
    expect(context.messages[0]?.content).toEqual([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({ type: "image", mimeType: "image/png" }),
    ]);
  });

  it("extracts assistant text blocks only", () => {
    expect(
      extractAssistantText({
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: " ok " },
          { type: "toolCall", id: "1", name: "noop", arguments: {} },
        ],
      }),
    ).toBe("ok");
  });

  it("detects image input support from model metadata", () => {
    expect(modelSupportsImageInput({ input: ["text", "image"] })).toBe(true);
    expect(modelSupportsImageInput({ input: ["text"] })).toBe(false);
  });

  it("matches expected probe replies", () => {
    expect(fileProbeTextMatches(`The value is ${LIVE_MODEL_FILE_PROBE_TOKEN}.`)).toBe(true);
    expect(fileProbeTextMatches("OPAL-731")).toBe(false);
    expect(imageProbeTextMatches("OK")).toBe(true);
    expect(imageProbeTextMatches("blue")).toBe(false);
  });
});
