import type { OpenClawConfig } from "./config-types.js";
import { loadBundledPluginPublicSurfaceModuleSync } from "./facade-loader.js";

export type { ResolvedTelegramAccount } from "../../extensions/telegram/api.js";

type TelegramAccountFacadeModule = {
  resolveTelegramAccount: typeof import("../../extensions/telegram/api.js").resolveTelegramAccount;
};

function loadTelegramAccountFacadeModule(): TelegramAccountFacadeModule {
  return loadBundledPluginPublicSurfaceModuleSync<TelegramAccountFacadeModule>({
    dirName: "telegram",
    artifactBasename: "api.js",
  });
}

/**
 * @deprecated Compatibility facade for plugin code that needs Telegram account resolution.
 * New channel plugins should prefer injected runtime helpers and generic SDK subpaths.
 */
export function resolveTelegramAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ReturnType<TelegramAccountFacadeModule["resolveTelegramAccount"]> {
  return loadTelegramAccountFacadeModule().resolveTelegramAccount(params);
}
