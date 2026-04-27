import { getRuntimeConfig } from "../../config/config.js";
import {
  mutateConfigFile as mutateConfigFileInternal,
  replaceConfigFile as replaceConfigFileInternal,
} from "../../config/mutate.js";
import type { PluginRuntime } from "./types.js";

export function createRuntimeConfig(): PluginRuntime["config"] {
  return {
    current: getRuntimeConfig,
    mutateConfigFile: async (params) =>
      await mutateConfigFileInternal({
        ...params,
        writeOptions: params.writeOptions,
      }),
    replaceConfigFile: async (params) =>
      await replaceConfigFileInternal({
        ...params,
        writeOptions: params.writeOptions,
      }),
    loadConfig: getRuntimeConfig,
    writeConfigFile: async (cfg, options) => {
      await replaceConfigFileInternal({
        nextConfig: cfg,
        afterWrite: options?.afterWrite ?? { mode: "auto" },
        writeOptions: options,
      });
    },
  };
}
