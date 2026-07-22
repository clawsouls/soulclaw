/**
 * SoulClaw Memory Search Engine — Vector Store
 *
 * SQLite + sqlite-vec vector storage with cosine similarity search.
 * Uses node:sqlite (DatabaseSync) consistent with the existing codebase.
 */

import type { DatabaseSync } from "node:sqlite";
import type { VectorStoreConfig } from "./config.js";
import { DEFAULT_VECTOR_STORE_CONFIG } from "./config.js";
import { loadSqliteVecExtension } from "./sqlite-vec.js";
import { requireNodeSqlite } from "./sqlite.js";

export interface StoredChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  heading: string | null;
  content: string;
  contentHash: string;
  vector: Float32Array;
  updatedAt: number;
}

export interface VectorSearchResult {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  heading: string | null;
  content: string;
  distance: number;
  score: number; // 1 - distance (cosine similarity)
}

export interface VectorStoreStats {
  totalChunks: number;
  totalFiles: number;
  dbSizeBytes: number;
}

export class VectorStore {
  private db: DatabaseSync | null = null;
  private readonly config: VectorStoreConfig;
  private vecAvailable = false;

  constructor(config?: Partial<VectorStoreConfig>) {
    this.config = { ...DEFAULT_VECTOR_STORE_CONFIG, ...config };
  }

  async init(): Promise<void> {
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(this.config.dbPath, { allowExtension: true });

    // Load sqlite-vec
    const result = await loadSqliteVecExtension({ db: this.db });
    this.vecAvailable = result.ok;

    // Create metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        heading TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
    `);

    // Create vector table if sqlite-vec is available
    if (this.vecAvailable) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
            id TEXT PRIMARY KEY,
            embedding FLOAT[${this.config.dimensions}]
          );
        `);
      } catch {
        this.vecAvailable = false;
      }
    }
  }

  private ensureDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("VectorStore not initialized. Call init() first.");
    }
    return this.db;
  }

  upsert(chunk: StoredChunk): void {
    const db = this.ensureDb();

    // Check if content changed
    const existing = db.prepare("SELECT content_hash FROM chunks WHERE id = ?").get(chunk.id) as
      | { content_hash: string }
      | undefined;

    if (existing && existing.content_hash === chunk.contentHash) {
      return; // No change
    }

    // Upsert metadata
    db.prepare(`
      INSERT OR REPLACE INTO chunks (id, file_path, start_line, end_line, heading, content, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunk.id,
      chunk.filePath,
      chunk.startLine,
      chunk.endLine,
      chunk.heading,
      chunk.content,
      chunk.contentHash,
      chunk.updatedAt,
    );

    // Upsert vector
    if (this.vecAvailable && chunk.vector.length > 0) {
      const vectorBlob = Buffer.from(
        chunk.vector.buffer,
        chunk.vector.byteOffset,
        chunk.vector.byteLength,
      );
      try {
        // Delete existing vector entry first (vec0 doesn't support REPLACE)
        db.prepare("DELETE FROM chunks_vec WHERE id = ?").run(chunk.id);
        db.prepare("INSERT INTO chunks_vec (id, embedding) VALUES (?, ?)").run(
          chunk.id,
          vectorBlob,
        );
      } catch {
        // Silently ignore vec insert failures
      }
    }
  }

  upsertBatch(chunks: StoredChunk[]): void {
    const db = this.ensureDb();
    const transaction = db.prepare("BEGIN");
    const commit = db.prepare("COMMIT");
    const rollback = db.prepare("ROLLBACK");

    transaction.run();
    try {
      for (const chunk of chunks) {
        this.upsert(chunk);
      }
      commit.run();
    } catch (err) {
      rollback.run();
      throw err;
    }
  }

  deleteByFile(filePath: string): void {
    const db = this.ensureDb();

    if (this.vecAvailable) {
      // Get chunk IDs for this file
      const rows = db.prepare("SELECT id FROM chunks WHERE file_path = ?").all(filePath) as Array<{
        id: string;
      }>;

      for (const row of rows) {
        try {
          db.prepare("DELETE FROM chunks_vec WHERE id = ?").run(row.id);
        } catch {
          // ignore
        }
      }
    }

    db.prepare("DELETE FROM chunks WHERE file_path = ?").run(filePath);
  }

  search(queryVector: Float32Array, topK: number, minScore = 0): VectorSearchResult[] {
    const db = this.ensureDb();

    if (!this.vecAvailable) {
      return [];
    }

    const vectorBlob = Buffer.from(
      queryVector.buffer,
      queryVector.byteOffset,
      queryVector.byteLength,
    );

    try {
      const rows = db
        .prepare(
          `SELECT c.id, c.file_path, c.start_line, c.end_line,
                  c.heading, c.content, v.distance
           FROM chunks_vec v
           JOIN chunks c ON c.id = v.id
           WHERE v.embedding MATCH ? AND k = ?
           ORDER BY v.distance`,
        )
        .all(vectorBlob, topK) as Array<{
        id: string;
        file_path: string;
        start_line: number;
        end_line: number;
        heading: string | null;
        content: string;
        distance: number;
      }>;

      return rows
        .map((row) => ({
          id: row.id,
          filePath: row.file_path,
          startLine: row.start_line,
          endLine: row.end_line,
          heading: row.heading,
          content: row.content,
          distance: row.distance,
          score: 1 - row.distance,
        }))
        .filter((r) => r.score >= minScore);
    } catch {
      return [];
    }
  }

  /** Get content hash for a chunk ID */
  getContentHash(id: string): string | null {
    const db = this.ensureDb();
    const row = db.prepare("SELECT content_hash FROM chunks WHERE id = ?").get(id) as
      | { content_hash: string }
      | undefined;
    return row?.content_hash ?? null;
  }

  /** Get all chunk IDs for a file */
  getChunkIdsByFile(filePath: string): string[] {
    const db = this.ensureDb();
    const rows = db.prepare("SELECT id FROM chunks WHERE file_path = ?").all(filePath) as Array<{
      id: string;
    }>;
    return rows.map((r) => r.id);
  }

  stats(): VectorStoreStats {
    const db = this.ensureDb();
    const countRow = db.prepare("SELECT COUNT(*) as cnt FROM chunks").get() as {
      cnt: number;
    };
    const filesRow = db.prepare("SELECT COUNT(DISTINCT file_path) as cnt FROM chunks").get() as {
      cnt: number;
    };

    let dbSizeBytes = 0;
    try {
      const sizeRow = db
        .prepare(
          "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()",
        )
        .get() as { size: number } | undefined;
      dbSizeBytes = sizeRow?.size ?? 0;
    } catch {
      // ignore
    }

    return {
      totalChunks: countRow.cnt,
      totalFiles: filesRow.cnt,
      dbSizeBytes,
    };
  }

  get isVecAvailable(): boolean {
    return this.vecAvailable;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
