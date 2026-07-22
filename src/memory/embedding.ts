/**
 * SoulClaw Memory Search Engine — Embedding Service
 *
 * Ollama nomic-embed-text embeddings with batch support, caching, and fallback.
 */

import crypto from "node:crypto";
import type { EmbeddingConfig } from "./config.js";
import { DEFAULT_EMBEDDING_CONFIG } from "./config.js";

export interface EmbeddingResult {
  vector: Float32Array;
  model: string;
  cached: boolean;
}

export class EmbeddingService {
  private readonly config: EmbeddingConfig;
  private readonly cache = new Map<string, Float32Array>();
  private available: boolean | null = null;

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  }

  private contentHash(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
  }

  async isAvailable(): Promise<boolean> {
    if (this.config.provider === "none") {
      return false;
    }
    if (this.available !== null) {
      return this.available;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${this.config.ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      this.available = resp.ok;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async ensureModel(): Promise<boolean> {
    if (!(await this.isAvailable())) {
      return false;
    }
    try {
      const resp = await fetch(`${this.config.ollamaUrl}/api/tags`);
      if (!resp.ok) {
        return false;
      }
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      const hasModel = models.some(
        (m) => m.name === this.config.model || m.name === `${this.config.model}:latest`,
      );
      if (hasModel) {
        return true;
      }

      // Pull model
      const pullResp = await fetch(`${this.config.ollamaUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.config.model, stream: false }),
      });
      return pullResp.ok;
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const hash = this.contentHash(text);
    const cached = this.cache.get(hash);
    if (cached) {
      return { vector: cached, model: this.config.model, cached: true };
    }

    const results = await this.callOllama([text]);
    const vector = results[0];
    if (!vector) {
      throw new Error("Ollama returned empty embedding");
    }
    this.cache.set(hash, vector);
    return { vector, model: this.config.model, cached: false };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return [];
    }

    const results: EmbeddingResult[] = Array.from<EmbeddingResult>({ length: texts.length });
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const hash = this.contentHash(text);
      const cached = this.cache.get(hash);
      if (cached) {
        results[i] = { vector: cached, model: this.config.model, cached: true };
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(text);
      }
    }

    if (uncachedTexts.length === 0) {
      return results;
    }

    // Process in batches
    for (let start = 0; start < uncachedTexts.length; start += this.config.batchSize) {
      const batchTexts = uncachedTexts.slice(start, start + this.config.batchSize);
      const batchVectors = await this.callOllama(batchTexts);

      for (let j = 0; j < batchTexts.length; j++) {
        const globalIdx = uncachedIndices[start + j];
        const vector = batchVectors[j];
        if (!vector) {
          continue;
        }

        const hash = this.contentHash(batchTexts[j]);
        this.cache.set(hash, vector);
        results[globalIdx] = {
          vector,
          model: this.config.model,
          cached: false,
        };
      }
    }

    return results;
  }

  private async callOllama(texts: string[]): Promise<Float32Array[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const resp = await fetch(`${this.config.ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          input: texts,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Ollama embed failed: ${resp.status} ${body}`);
      }

      const data = (await resp.json()) as { embeddings: number[][] };
      return data.embeddings.map((emb) => new Float32Array(emb));
    } finally {
      clearTimeout(timer);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  /** Reset availability check (e.g., after Ollama starts) */
  resetAvailability(): void {
    this.available = null;
  }
}
