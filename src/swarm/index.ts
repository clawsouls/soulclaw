/**
 * Swarm Memory — Native multi-agent memory sync via git
 *
 * @module swarm
 */

export { SwarmClient, type SwarmStatus } from "./client.js";
export { syncCycle, syncToWorkspace, syncFromWorkspace, type SyncResult } from "./auto-sync.js";
export {
  resolveConflict,
  hasConflictMarkers,
  type ConflictResolution,
} from "./conflict-resolver.js";
export { type SwarmConfig, DEFAULT_SWARM_CONFIG, resolveSwarmConfig } from "./config.js";
