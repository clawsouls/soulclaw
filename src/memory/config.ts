/**
 * SoulClaw Memory Search Engine — Configuration
 *
 * Centralized configuration types and defaults for the memory search system.
 */

export interface ChunkerConfig {
  maxTokens: number;
  overlapTokens: number;
  splitBy: "heading" | "paragraph" | "hybrid";
}

export interface EmbeddingConfig {
  provider: "ollama" | "none";
  model: string;
  ollamaUrl: string;
  batchSize: number;
  dimensions: number;
  timeoutMs: number;
}

export interface VectorStoreConfig {
  dbPath: string;
  dimensions: number;
}

export interface SearchConfig {
  maxResults: number;
  minScore: number;
}

export interface WatchTarget {
  patterns: string[];
  rootDir: string;
}

export interface MemorySearchConfig {
  chunking: ChunkerConfig;
  embedding: EmbeddingConfig;
  vectorStore: VectorStoreConfig;
  search: SearchConfig;
  watch: WatchTarget;
}

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  maxTokens: 400,
  overlapTokens: 50,
  splitBy: "hybrid",
};

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "ollama",
  model: "bge-m3",
  ollamaUrl: "http://localhost:11434",
  batchSize: 32,
  dimensions: 1024,
  timeoutMs: 60_000,
};

export const DEFAULT_VECTOR_STORE_CONFIG: VectorStoreConfig = {
  dbPath: "memory-index.db",
  dimensions: 1024,
};

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  maxResults: 6,
  minScore: 0.3,
};

export const DEFAULT_WATCH_TARGET: WatchTarget = {
  patterns: ["MEMORY.md", "memory/**/*.md"],
  rootDir: ".",
};

export function resolveMemorySearchConfig(
  overrides?: Partial<MemorySearchConfig>,
): MemorySearchConfig {
  return {
    chunking: { ...DEFAULT_CHUNKER_CONFIG, ...overrides?.chunking },
    embedding: { ...DEFAULT_EMBEDDING_CONFIG, ...overrides?.embedding },
    vectorStore: { ...DEFAULT_VECTOR_STORE_CONFIG, ...overrides?.vectorStore },
    search: { ...DEFAULT_SEARCH_CONFIG, ...overrides?.search },
    watch: { ...DEFAULT_WATCH_TARGET, ...overrides?.watch },
  };
}
