/**
 * SoulClaw Memory Search Engine — File Watcher
 *
 * Chokidar-based file change detection with debouncing.
 */

import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { WatchTarget } from "./config.js";
import { DEFAULT_WATCH_TARGET } from "./config.js";

export interface FileChangeEvent {
  type: "add" | "change" | "unlink";
  filePath: string;
  relativePath: string;
}

export class MemoryFileWatcher {
  private watcher: FSWatcher | null = null;
  private readonly config: WatchTarget;
  private readonly debounceMs: number;
  private readonly onChange: (events: FileChangeEvent[]) => void;
  private pendingEvents: FileChangeEvent[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    config: Partial<WatchTarget> | undefined,
    onChange: (events: FileChangeEvent[]) => void,
    debounceMs = 1000,
  ) {
    this.config = { ...DEFAULT_WATCH_TARGET, ...config };
    this.onChange = onChange;
    this.debounceMs = debounceMs;
  }

  start(): void {
    if (this.watcher) {
      return;
    }

    const watchPaths = this.config.patterns.map((p) => path.resolve(this.config.rootDir, p));

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    const handleEvent = (type: "add" | "change" | "unlink", filePath: string) => {
      const relativePath = path.relative(this.config.rootDir, filePath).replace(/\\/g, "/");
      this.pendingEvents.push({ type, filePath, relativePath });
      this.scheduleFlush();
    };

    this.watcher.on("add", (fp) => handleEvent("add", fp));
    this.watcher.on("change", (fp) => handleEvent("change", fp));
    this.watcher.on("unlink", (fp) => handleEvent("unlink", fp));
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      const events = this.pendingEvents;
      this.pendingEvents = [];
      this.debounceTimer = null;
      if (events.length > 0) {
        this.onChange(events);
      }
    }, this.debounceMs);
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    this.pendingEvents = [];
  }
}
