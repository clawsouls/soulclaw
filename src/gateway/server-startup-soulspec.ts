// SoulClaw startup sidecars: boot-time SoulScan integrity check + Swarm Memory sync.
//
// The SoulClaw pipeline (commit 9144145289 on the old fork) wired three engines as
// fire-and-forget hooks after each agent turn in the embedded runner: SoulScan
// (soulscan/inline-scan), persona drift (persona/inline-drift), and Swarm Memory
// (swarm/inline-sync). In v2026.7.1 the embedded runner is owned elsewhere, so the two
// engines that do not need per-turn message context are re-homed here at the gateway
// lifecycle — right next to the qmd memory backend — so they still run on boot.
//
// Persona drift is intentionally NOT wired here: it requires the per-turn assistant
// messages and belongs in the embedded agent runner, not at startup.
//
// Non-fatal: every engine is fire-and-forget and never blocks gateway startup.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { maybeInlineScan } from "../soulscan/inline-scan.js";
import { maybeSwarmSync } from "../swarm/inline-sync.js";

const STARTUP_SESSION_KEY = "gateway:startup";

/** Fire SoulClaw engine boot hooks (SoulScan + Swarm Memory sync) for the gateway workspace. */
export function startSoulSpecSidecars(params: {
  cfg: OpenClawConfig;
  workspaceDir: string;
  log: { warn: (msg: string) => void };
}): void {
  const { cfg, workspaceDir, log } = params;

  // Boot-time SoulScan: soul-file integrity check (rate-limited, fire-and-forget).
  void maybeInlineScan({ workspaceDir, sessionKey: STARTUP_SESSION_KEY }).catch((err: unknown) => {
    log.warn(`startup SoulScan failed: ${String(err)}`);
  });

  // Boot-time Swarm Memory sync: pull/resolve/push shared memory (rate-limited).
  const swarmCfg = cfg.agents?.defaults?.swarm;
  if (swarmCfg?.autoSync !== false) {
    void maybeSwarmSync({
      workspaceDir,
      sessionKey: STARTUP_SESSION_KEY,
      ...(swarmCfg?.dir ? { swarmConfig: { swarmDir: swarmCfg.dir } } : {}),
    }).catch((err: unknown) => {
      log.warn(`startup swarm sync failed: ${String(err)}`);
    });
  }
}
