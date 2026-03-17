export { MemoryIndexManager } from "./manager.js";
export type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySearchResult,
} from "./types.js";
export { getMemorySearchManager, type MemorySearchManagerResult } from "./search-manager.js";

// SoulClaw Memory Search Engine
export { MemorySearchEngine } from "./search.js";
export type { SearchQuery, SearchResult } from "./search.js";
export { MemoryFileWatcher } from "./file-watcher.js";
export type { FileChangeEvent } from "./file-watcher.js";
export { EmbeddingService } from "./embedding.js";
export type { EmbeddingResult } from "./embedding.js";
export { VectorStore } from "./vector-store.js";
export type { StoredChunk, VectorSearchResult, VectorStoreStats } from "./vector-store.js";
export { chunkMarkdown } from "./chunker.js";
export type { Chunk } from "./chunker.js";
export { maybeExtractPassiveMemory, clearPassiveMemoryState } from "./passive-memory.js";
export type { PassiveMemoryConfig } from "./passive-memory.js";

// DAG Lossless Conversation Store
export { DagStore } from "./dag-store.js";
export { maybeDagStore, getDagStore } from "./dag-hook.js";
export { maybeSummarizeDag } from "./dag-summarizer.js";
export {
  resolveMemorySearchConfig,
  type MemorySearchConfig,
  type ChunkerConfig,
  type EmbeddingConfig,
  type VectorStoreConfig,
  type SearchConfig,
  type WatchTarget,
} from "./config.js";
