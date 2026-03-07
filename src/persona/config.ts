/**
 * Persona Engine configuration types and defaults.
 * @module persona/config
 */

export interface PersonaEngineConfig {
  /** Check drift every N responses */
  checkInterval: number;
  /** Drift score threshold for soft warning (0-1) */
  driftThreshold: number;
  /** Drift score threshold for severe alert (0-1) */
  severeThreshold: number;
  /** Ollama model for drift detection */
  ollamaModel: string;
  /** Ollama base URL */
  ollamaBaseUrl: string;
  /** Enable Ollama-based detection (falls back to keyword if false or unavailable) */
  useOllama: boolean;
  /** Path to store drift metrics */
  metricsPath: string;
  /** Maximum metric entries to retain */
  maxMetricEntries: number;
}

export const DEFAULT_PERSONA_CONFIG: PersonaEngineConfig = {
  checkInterval: 5,
  driftThreshold: 0.3,
  severeThreshold: 0.7,
  ollamaModel: "qwen3:8b",
  ollamaBaseUrl: "http://localhost:11434",
  useOllama: true,
  metricsPath: "data/persona-metrics.json",
  maxMetricEntries: 1000,
};

export function mergeConfig(partial?: Partial<PersonaEngineConfig>): PersonaEngineConfig {
  return { ...DEFAULT_PERSONA_CONFIG, ...partial };
}
