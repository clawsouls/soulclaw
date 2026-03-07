/**
 * Swarm Memory configuration
 */

import { homedir } from "os";
import { join } from "path";

export interface SwarmConfig {
  /** Path to the shared swarm git directory */
  swarmDir: string;
  /** Enable automatic sync on heartbeat */
  autoSync: boolean;
  /** Sync interval: 'heartbeat' or milliseconds */
  syncInterval: "heartbeat" | number;
  /** Ollama model for LLM conflict resolution */
  llmModel: string;
  /** Ollama API URL */
  ollamaUrl: string;
}

export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  swarmDir: join(homedir(), ".openclaw", "swarm"),
  autoSync: true,
  syncInterval: "heartbeat",
  llmModel: "gemma3:4b",
  ollamaUrl: "http://localhost:11434",
};

/**
 * Resolve swarm config with defaults
 */
export function resolveSwarmConfig(partial?: Partial<SwarmConfig>): SwarmConfig {
  return { ...DEFAULT_SWARM_CONFIG, ...partial };
}
