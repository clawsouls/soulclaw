// Memory Core plugin module owns builtin search manager acquisition and cleanup.
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
import {
  resolveAgentWorkspaceDir,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import type { MemorySearchManager } from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import { normalizeAgentId } from "openclaw/plugin-sdk/routing";
import type { MemoryCoreAcquireLocalService } from "./embedding-local-service.js";
import { wrapWithDagSearch } from "./dag-search.js";

const managerRuntimeLoader = createLazyRuntimeModule(() => import("../../manager-runtime.js"));
const loadManagerRuntime = managerRuntimeLoader;

type MemorySearchManagerPurpose = "default" | "status" | "cli";
type MemorySearchManagerParams = {
  cfg: OpenClawConfig;
  agentId: string;
  purpose?: MemorySearchManagerPurpose;
  inspectSources?: boolean;
  acquireLocalService?: MemoryCoreAcquireLocalService;
};

type MemorySearchManagerResult = {
  manager: MemorySearchManager | null;
  error?: string;
  debug?: {
    backend: "builtin";
    purpose: MemorySearchManagerPurpose;
    managerMs: number;
  };
};

export async function getMemorySearchManager(
  params: MemorySearchManagerParams,
): Promise<MemorySearchManagerResult> {
  const startedAt = Date.now();
  let result = await getBuiltinMemorySearchManager(params);
  // SoulClaw Soul Memory: merge DAG FTS5 conversation hits into memory_search.
  // Applied once at the public egress; wrapWithDagSearch is idempotent so a
  // recursive resolve never double-wraps.
  if (result.manager) {
    try {
      const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
      if (workspaceDir) {
        result = { ...result, manager: wrapWithDagSearch(result.manager, workspaceDir) };
      }
    } catch {
      // DAG wrapping is best-effort; fall through with the unwrapped manager.
    }
  }
  return {
    ...result,
    debug: {
      backend: "builtin",
      purpose: params.purpose ?? "default",
      managerMs: Math.max(0, Date.now() - startedAt),
    },
  };
}

async function getBuiltinMemorySearchManager(
  params: MemorySearchManagerParams,
): Promise<Omit<MemorySearchManagerResult, "debug">> {
  try {
    const { MemoryIndexManager } = await loadManagerRuntime();
    return { manager: await MemoryIndexManager.get(params) };
  } catch (err) {
    return { manager: null, error: formatErrorMessage(err) };
  }
}

export async function closeAllMemorySearchManagers(): Promise<void> {
  if (!managerRuntimeLoader.peek()) {
    return;
  }
  const { closeAllMemoryIndexManagers } = await loadManagerRuntime();
  await closeAllMemoryIndexManagers();
}

export async function closeMemorySearchManager(params: {
  cfg: OpenClawConfig;
  agentId: string;
}): Promise<void> {
  if (!managerRuntimeLoader.peek()) {
    return;
  }
  const { closeMemoryIndexManagersForAgent } = await loadManagerRuntime();
  await closeMemoryIndexManagersForAgent({
    agentId: normalizeAgentId(params.agentId),
  });
}
