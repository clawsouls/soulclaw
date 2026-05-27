import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  collectPluginConfigContractMatches,
  resolvePluginConfigContractsById,
  type PluginConfigContractMetadata,
} from "../plugins/config-contracts.js";
import { getCurrentPluginMetadataSnapshot } from "../plugins/current-plugin-metadata-snapshot.js";
import { isRecord } from "../utils.js";
import { collectEnabledInsecureOrDangerousFlagsFromContracts } from "./dangerous-config-flags-core.js";

function resolveCurrentPluginConfigContractsById(params: {
  cfg: OpenClawConfig;
  pluginIds: readonly string[];
}): ReadonlyMap<string, PluginConfigContractMetadata> | undefined {
  // Gateway startup already owns this metadata snapshot; reuse it here so
  // warning logs do not reload plugin manifests on the ready path.
  const snapshot = getCurrentPluginMetadataSnapshot({
    config: params.cfg,
    env: process.env,
    allowWorkspaceScopedSnapshot: true,
  });
  if (!snapshot) {
    return undefined;
  }

  const contractsById = new Map<string, PluginConfigContractMetadata>();
  for (const pluginId of params.pluginIds) {
    const normalizedPluginId = snapshot.normalizePluginId(pluginId);
    const plugin = snapshot.byPluginId.get(pluginId) ?? snapshot.byPluginId.get(normalizedPluginId);
    if (!plugin) {
      return undefined;
    }
    if (!plugin.configContracts) {
      continue;
    }
    contractsById.set(pluginId, {
      origin: plugin.origin,
      configContracts: plugin.configContracts,
    });
  }
  return contractsById;
}

export function collectEnabledInsecureOrDangerousFlags(
  cfg: OpenClawConfig,
  options: { preferCurrentPluginMetadataSnapshot?: boolean } = {},
): string[] {
  const pluginEntries = cfg.plugins?.entries;
  if (!isRecord(pluginEntries)) {
    return collectEnabledInsecureOrDangerousFlagsFromContracts(cfg);
  }
  const pluginIds = Object.keys(pluginEntries);

  const configContracts =
    (options.preferCurrentPluginMetadataSnapshot
      ? resolveCurrentPluginConfigContractsById({ cfg, pluginIds })
      : undefined) ??
    resolvePluginConfigContractsById({
      config: cfg,
      workspaceDir: resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg)),
      env: process.env,
      pluginIds,
    });
  return collectEnabledInsecureOrDangerousFlagsFromContracts(cfg, {
    collectPluginConfigContractMatches,
    configContractsById: configContracts,
  });
}
