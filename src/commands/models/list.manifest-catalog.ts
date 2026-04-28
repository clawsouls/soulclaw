import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  normalizeModelCatalogProviderId,
  planManifestModelCatalogRows,
} from "../../model-catalog/index.js";
import type { NormalizedModelCatalogRow } from "../../model-catalog/index.js";
import { loadPluginManifestRegistryForInstalledIndex } from "../../plugins/manifest-registry-installed.js";
import {
  getPluginRecord,
  isPluginEnabled,
  loadPluginRegistrySnapshot,
  resolvePluginContributionOwners,
  type PluginRegistrySnapshot,
} from "../../plugins/plugin-registry.js";

function loadManifestCatalogRowsForPluginIds(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  index: PluginRegistrySnapshot;
  pluginIds?: readonly string[];
  providerFilter?: string;
  staticOnly?: boolean;
}): readonly NormalizedModelCatalogRow[] {
  if (params.pluginIds && params.pluginIds.length === 0) {
    return [];
  }
  const registry = loadPluginManifestRegistryForInstalledIndex({
    index: params.index,
    config: params.cfg,
    env: params.env,
    pluginIds: params.pluginIds,
  });
  const plan = planManifestModelCatalogRows({
    registry,
    ...(params.providerFilter ? { providerFilter: params.providerFilter } : {}),
  });
  if (params.staticOnly === false) {
    return plan.rows;
  }
  const listableProviders = new Set(
    plan.entries.filter((entry) => entry.discovery !== "runtime").map((entry) => entry.provider),
  );
  if (listableProviders.size === 0) {
    return [];
  }
  return plan.rows.filter((row) => listableProviders.has(row.provider));
}

function resolveConventionModelCatalogPluginIds(params: {
  cfg: OpenClawConfig;
  index: PluginRegistrySnapshot;
  providerFilter: string;
}): readonly string[] {
  const record = getPluginRecord({
    index: params.index,
    pluginId: params.providerFilter,
  });
  if (
    !record ||
    !isPluginEnabled({
      index: params.index,
      pluginId: record.pluginId,
      config: params.cfg,
    })
  ) {
    return [];
  }
  return [record.pluginId];
}

function resolveDeclaredModelCatalogPluginIds(params: {
  cfg: OpenClawConfig;
  index: PluginRegistrySnapshot;
  providerFilter: string;
}): readonly string[] {
  return resolvePluginContributionOwners({
    index: params.index,
    config: params.cfg,
    contribution: "modelCatalogProviders",
    matches: params.providerFilter,
  });
}

export function loadManifestCatalogRowsForList(params: {
  cfg: OpenClawConfig;
  providerFilter?: string;
  env?: NodeJS.ProcessEnv;
  staticOnly?: boolean;
}): readonly NormalizedModelCatalogRow[] {
  const providerFilter = params.providerFilter
    ? normalizeModelCatalogProviderId(params.providerFilter)
    : undefined;
  const index = loadPluginRegistrySnapshot({
    config: params.cfg,
    env: params.env,
  });
  if (!providerFilter) {
    return loadManifestCatalogRowsForPluginIds({
      cfg: params.cfg,
      env: params.env,
      index,
      staticOnly: params.staticOnly,
    });
  }
  const conventionRows = loadManifestCatalogRowsForPluginIds({
    cfg: params.cfg,
    env: params.env,
    index,
    pluginIds: resolveConventionModelCatalogPluginIds({
      cfg: params.cfg,
      index,
      providerFilter,
    }),
    providerFilter,
    staticOnly: params.staticOnly,
  });
  if (conventionRows.length > 0) {
    return conventionRows;
  }
  return loadManifestCatalogRowsForPluginIds({
    cfg: params.cfg,
    env: params.env,
    index,
    pluginIds: resolveDeclaredModelCatalogPluginIds({
      cfg: params.cfg,
      index,
      providerFilter,
    }),
    providerFilter,
    staticOnly: params.staticOnly,
  });
}

export function loadStaticManifestCatalogRowsForList(params: {
  cfg: OpenClawConfig;
  providerFilter?: string;
  env?: NodeJS.ProcessEnv;
}): readonly NormalizedModelCatalogRow[] {
  return loadManifestCatalogRowsForList({
    ...params,
    staticOnly: true,
  });
}
