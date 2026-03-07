/**
 * SoulClaw Memory Search Engine — Integrated Search
 *
 * Vector search with text fallback when Ollama is unavailable.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chunkMarkdown, type Chunk } from "./chunker.js";
import type { MemorySearchConfig } from "./config.js";
import { resolveMemorySearchConfig } from "./config.js";
import { EmbeddingService } from "./embedding.js";
import { MemoryFileWatcher, type FileChangeEvent } from "./file-watcher.js";
import { VectorStore, type StoredChunk } from "./vector-store.js";

export interface SearchQuery {
  query: string;
  maxResults?: number;
  minScore?: number;
}

export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  heading: string | null;
  snippet: string;
  score: number;
  source: "vector" | "text";
}

export class MemorySearchEngine {
  private readonly workspaceDir: string;
  private readonly config: MemorySearchConfig;
  private readonly embedding: EmbeddingService;
  private readonly store: VectorStore;
  private readonly watcher: MemoryFileWatcher;
  private initialized = false;
  private fileContents = new Map<string, string>();

  constructor(workspaceDir: string, config?: Partial<MemorySearchConfig>) {
    this.workspaceDir = workspaceDir;
    this.config = resolveMemorySearchConfig(config);
    this.embedding = new EmbeddingService(this.config.embedding);
    this.store = new VectorStore({
      ...this.config.vectorStore,
      dbPath: path.resolve(workspaceDir, this.config.vectorStore.dbPath),
    });
    this.watcher = new MemoryFileWatcher(
      { ...this.config.watch, rootDir: workspaceDir },
      (events) => void this.handleFileChanges(events),
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.store.init();

    const vectorAvailable = this.store.isVecAvailable && (await this.embedding.isAvailable());

    if (vectorAvailable) {
      await this.embedding.ensureModel();
    }

    // Scan and index files
    await this.indexAllFiles();

    // Start watching
    this.watcher.start();
    this.initialized = true;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const maxResults = query.maxResults ?? this.config.search.maxResults;
    const minScore = query.minScore ?? this.config.search.minScore;

    if (await this.embedding.isAvailable()) {
      return this.vectorSearch(query.query, maxResults, minScore);
    }
    return this.textSearch(query.query, maxResults, minScore);
  }

  private async vectorSearch(
    query: string,
    maxResults: number,
    minScore: number,
  ): Promise<SearchResult[]> {
    try {
      const { vector } = await this.embedding.embed(query);
      const results = this.store.search(vector, maxResults, minScore);
      return results.map((r) => ({
        path: r.filePath,
        startLine: r.startLine,
        endLine: r.endLine,
        heading: r.heading,
        snippet: r.content.slice(0, 700),
        score: r.score,
        source: "vector" as const,
      }));
    } catch {
      // Fallback to text search on vector search failure
      return this.textSearch(query, maxResults, minScore);
    }
  }

  private textSearch(query: string, maxResults: number, minScore: number): SearchResult[] {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);
    const results: SearchResult[] = [];

    for (const [relPath, content] of this.fileContents) {
      const lines = content.split("\n");
      let currentHeading: string | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const headingMatch = line.match(/^#{1,3}\s+(.+)/);
        if (headingMatch) {
          currentHeading = line;
        }

        const lineLower = line.toLowerCase();
        let matchCount = 0;
        for (const term of queryTerms) {
          if (lineLower.includes(term)) {
            matchCount++;
          }
        }

        if (matchCount > 0) {
          const score = matchCount / queryTerms.length;
          if (score >= minScore) {
            // Get surrounding context
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length - 1, i + 2);
            const snippet = lines.slice(start, end + 1).join("\n");

            results.push({
              path: relPath,
              startLine: start + 1,
              endLine: end + 1,
              heading: currentHeading,
              snippet: snippet.slice(0, 700),
              score,
              source: "text",
            });
          }
        }
      }
    }

    // Deduplicate overlapping results and sort
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  async reindex(): Promise<{ chunksIndexed: number; filesProcessed: number }> {
    return this.indexAllFiles();
  }

  async shutdown(): Promise<void> {
    this.watcher.stop();
    this.store.close();
    this.initialized = false;
  }

  private async indexAllFiles(): Promise<{
    chunksIndexed: number;
    filesProcessed: number;
  }> {
    const files = this.scanFiles();
    let chunksIndexed = 0;

    const vectorAvailable = this.store.isVecAvailable && (await this.embedding.isAvailable());

    for (const filePath of files) {
      const absPath = path.resolve(this.workspaceDir, filePath);
      let content: string;
      try {
        content = fs.readFileSync(absPath, "utf-8");
      } catch {
        continue;
      }

      this.fileContents.set(filePath, content);
      const chunks = chunkMarkdown(content, filePath, this.config.chunking);

      if (vectorAvailable && chunks.length > 0) {
        const texts = chunks.map((c) => c.content);
        let embeddings: Awaited<ReturnType<EmbeddingService["embedBatch"]>>;
        try {
          embeddings = await this.embedding.embedBatch(texts);
        } catch {
          continue;
        }

        const storedChunks: StoredChunk[] = chunks.map((chunk, i) => ({
          id: chunk.id,
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          heading: chunk.heading,
          content: chunk.content,
          contentHash: crypto.createHash("sha256").update(chunk.content).digest("hex"),
          vector: embeddings[i]?.vector ?? new Float32Array(0),
          updatedAt: Date.now(),
        }));

        this.store.upsertBatch(storedChunks);
        chunksIndexed += storedChunks.length;
      }
    }

    return { chunksIndexed, filesProcessed: files.length };
  }

  private scanFiles(): string[] {
    const files: string[] = [];

    // MEMORY.md
    const memoryMd = path.resolve(this.workspaceDir, "MEMORY.md");
    if (fs.existsSync(memoryMd)) {
      files.push("MEMORY.md");
    }

    // memory/*.md
    const memoryDir = path.resolve(this.workspaceDir, "memory");
    if (fs.existsSync(memoryDir) && fs.statSync(memoryDir).isDirectory()) {
      const entries = fs.readdirSync(memoryDir, { recursive: true });
      for (const entry of entries) {
        const entryStr = String(entry);
        if (entryStr.endsWith(".md")) {
          files.push(path.join("memory", entryStr).replace(/\\/g, "/"));
        }
      }
    }

    return files;
  }

  private async handleFileChanges(events: FileChangeEvent[]): Promise<void> {
    const vectorAvailable = this.store.isVecAvailable && (await this.embedding.isAvailable());

    for (const event of events) {
      if (event.type === "unlink") {
        this.store.deleteByFile(event.relativePath);
        this.fileContents.delete(event.relativePath);
        continue;
      }

      // add or change
      let content: string;
      try {
        content = fs.readFileSync(event.filePath, "utf-8");
      } catch {
        continue;
      }

      this.fileContents.set(event.relativePath, content);
      const chunks = chunkMarkdown(content, event.relativePath, this.config.chunking);

      if (vectorAvailable && chunks.length > 0) {
        // Incremental: only re-embed changed chunks
        const changedChunks: Chunk[] = [];
        for (const chunk of chunks) {
          const hash = crypto.createHash("sha256").update(chunk.content).digest("hex");
          const existingHash = this.store.getContentHash(chunk.id);
          if (existingHash !== hash) {
            changedChunks.push(chunk);
          }
        }

        if (changedChunks.length > 0) {
          const texts = changedChunks.map((c) => c.content);
          try {
            const embeddings = await this.embedding.embedBatch(texts);
            const storedChunks: StoredChunk[] = changedChunks.map((chunk, i) => ({
              id: chunk.id,
              filePath: chunk.filePath,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              heading: chunk.heading,
              content: chunk.content,
              contentHash: crypto.createHash("sha256").update(chunk.content).digest("hex"),
              vector: embeddings[i]?.vector ?? new Float32Array(0),
              updatedAt: Date.now(),
            }));
            this.store.upsertBatch(storedChunks);
          } catch {
            // Ignore embedding failures for incremental updates
          }
        }

        // Remove chunks that no longer exist
        const currentIds = new Set(chunks.map((c) => c.id));
        const existingIds = this.store.getChunkIdsByFile(event.relativePath);
        for (const id of existingIds) {
          if (!currentIds.has(id)) {
            // Individual chunk removal would need a deleteById method
            // For now, handled by deleteByFile + re-insert on next full reindex
          }
        }
      }
    }
  }
}
