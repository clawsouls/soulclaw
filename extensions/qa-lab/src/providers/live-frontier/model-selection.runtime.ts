import {
  listProfilesForProvider,
  loadAuthProfileStoreForRuntime,
} from "openclaw/plugin-sdk/agent-runtime";
import { resolveEnvApiKey } from "openclaw/plugin-sdk/provider-auth";

const QA_CODEX_OAUTH_LIVE_MODEL = "openai/gpt-5.5";

export function resolveQaLiveFrontierPreferredModel() {
  if (resolveEnvApiKey("openai")?.apiKey) {
    return undefined;
  }
  try {
    const store = loadAuthProfileStoreForRuntime(undefined, {
      readOnly: true,
      allowKeychainPrompt: false,
      externalCliProviderIds: ["openai"],
    });
    const openAiProfileIds = listProfilesForProvider(store, "openai");
    const openAiProfileModes = openAiProfileIds.map((profileId) => store.profiles[profileId]?.mode);
    if (openAiProfileModes.some((mode) => mode === "api_key" || mode === "aws-sdk")) {
      return undefined;
    }
    return openAiProfileModes.some((mode) => mode === "oauth" || mode === "token")
      ? QA_CODEX_OAUTH_LIVE_MODEL
      : undefined;
  } catch {
    return undefined;
  }
}
