/**
 * Drift metrics — records drift check history and provides statistics.
 * Uses JSON file storage for simplicity.
 * @module persona/metrics
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PersonaEngineConfig } from "./config.js";
import type { DriftResult } from "./drift-detector.js";

export interface MetricEntry {
  score: number;
  method: "ollama" | "keyword";
  timestamp: number;
  details?: string;
}

export interface MetricsStore {
  entries: MetricEntry[];
}

// ─── File I/O ──────────────────────────────────────────────────

async function loadStore(path: string): Promise<MetricsStore> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as MetricsStore;
  } catch {
    return { entries: [] };
  }
}

async function saveStore(path: string, store: MetricsStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), "utf-8");
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Record a drift result to the metrics file.
 */
export async function recordDrift(result: DriftResult, config: PersonaEngineConfig): Promise<void> {
  const store = await loadStore(config.metricsPath);
  store.entries.push({
    score: result.score,
    method: result.method,
    timestamp: result.timestamp,
    details: result.details,
  });

  // Trim to max entries
  if (store.entries.length > config.maxMetricEntries) {
    store.entries = store.entries.slice(-config.maxMetricEntries);
  }

  await saveStore(config.metricsPath, store);
}

/**
 * Get the average drift score over the last N checks.
 */
export async function getAverageDrift(config: PersonaEngineConfig, lastN = 10): Promise<number> {
  const store = await loadStore(config.metricsPath);
  const recent = store.entries.slice(-lastN);
  if (recent.length === 0) {
    return 0;
  }
  return recent.reduce((sum, e) => sum + e.score, 0) / recent.length;
}

/**
 * Get drift trend bucketed by hour.
 */
export async function getDriftTrend(
  config: PersonaEngineConfig,
  hours = 24,
): Promise<Array<{ hour: string; avgScore: number; count: number }>> {
  const store = await loadStore(config.metricsPath);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const recent = store.entries.filter((e) => e.timestamp >= cutoff);

  const buckets = new Map<string, { total: number; count: number }>();
  for (const entry of recent) {
    const hour = new Date(entry.timestamp).toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const bucket = buckets.get(hour) ?? { total: 0, count: 0 };
    bucket.total += entry.score;
    bucket.count += 1;
    buckets.set(hour, bucket);
  }

  return Array.from(buckets.entries())
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([hour, { total, count }]) => ({
      hour,
      avgScore: total / count,
      count,
    }));
}

/**
 * Get all entries (for export / debugging).
 */
export async function getAllMetrics(config: PersonaEngineConfig): Promise<MetricEntry[]> {
  const store = await loadStore(config.metricsPath);
  return store.entries;
}
