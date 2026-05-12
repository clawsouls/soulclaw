import {
  applyAgentDefaultModelPrimary,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";

export const GOOGLE_GEMINI_DEFAULT_MODEL = "google/gemini-3.1-pro-preview";
const RETIRED_GOOGLE_GEMINI_MODEL_REFS = new Set([
  "google/gemini-3-pro",
  "google/gemini-3-pro-preview",
]);

function hasRetiredGeminiDefaultModelRefs(cfg: OpenClawConfig): boolean {
  const defaults = cfg.agents?.defaults;
  const model = defaults?.model as unknown;
  if (model && typeof model === "object") {
    const fallbacks = (model as { fallbacks?: unknown }).fallbacks;
    if (
      Array.isArray(fallbacks) &&
      fallbacks.some(
        (fallback) =>
          typeof fallback === "string" && RETIRED_GOOGLE_GEMINI_MODEL_REFS.has(fallback),
      )
    ) {
      return true;
    }
  }

  const models = defaults?.models;
  return Boolean(
    models &&
    typeof models === "object" &&
    Object.keys(models).some((modelRef) => RETIRED_GOOGLE_GEMINI_MODEL_REFS.has(modelRef)),
  );
}

export function applyGoogleGeminiModelDefault(cfg: OpenClawConfig): {
  next: OpenClawConfig;
  changed: boolean;
} {
  const current = cfg.agents?.defaults?.model as unknown;
  const currentPrimary =
    typeof current === "string"
      ? current.trim() || undefined
      : current &&
          typeof current === "object" &&
          typeof (current as { primary?: unknown }).primary === "string"
        ? ((current as { primary: string }).primary || "").trim() || undefined
        : undefined;
  if (currentPrimary === GOOGLE_GEMINI_DEFAULT_MODEL && !hasRetiredGeminiDefaultModelRefs(cfg)) {
    return { next: cfg, changed: false };
  }
  return {
    next: applyAgentDefaultModelPrimary(cfg, GOOGLE_GEMINI_DEFAULT_MODEL),
    changed: true,
  };
}
