/**
 * Topic Snapshot Hooks — wire topic-snapshot into SoulClaw's lifecycle.
 *
 * Registered as built-in hooks (not plugins) during gateway init.
 * All errors are caught and logged — never thrown.
 */

import type { SubsystemLogger } from "../logging/subsystem.js";
import {
  TopicMap,
  TopicSnapshot,
  buildInjectionText,
  shouldSkipSession,
  suggestTopicNameFromSummary,
} from "./topic-snapshot.js";

export interface TopicSnapshotHookContext {
  sessionKey: string;
  workspaceDir: string;
  log: SubsystemLogger;
}

// ── before_compaction ──────────────────────────────────────────────────────────
export async function topicBeforeCompaction(
  event: { messageCount: number; tokenCount?: number },
  ctx: TopicSnapshotHookContext,
): Promise<void> {
  try {
    if (shouldSkipSession(ctx.sessionKey)) {
      return;
    }

    const map = new TopicMap(ctx.workspaceDir);
    await map.load();

    let topic = map.getTopicForSession(ctx.sessionKey);
    if (!topic) {
      topic = map.autoBindSession(ctx.sessionKey);
      await map.save();
      ctx.log.info(`[topic-snapshot] auto-bound session → topic "${topic}"`);
    }

    await TopicSnapshot.appendHistory(
      ctx.workspaceDir,
      topic,
      `auto-saved before compaction (${event.messageCount} messages)`,
      ctx.sessionKey,
    );

    ctx.log.info(
      `[topic-snapshot] saved before compaction: topic="${topic}" messages=${event.messageCount}`,
    );
  } catch (err) {
    ctx.log.warn("[topic-snapshot] before_compaction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── after_compaction ───────────────────────────────────────────────────────────
export async function topicAfterCompaction(
  event: { messageCount: number; compactedCount: number; summary?: string },
  ctx: TopicSnapshotHookContext,
): Promise<void> {
  try {
    if (shouldSkipSession(ctx.sessionKey)) {
      return;
    }

    const map = new TopicMap(ctx.workspaceDir);
    await map.load();

    let topic = map.getTopicForSession(ctx.sessionKey);

    // If no topic bound yet and we have a summary, try keyword-based suggestion
    if (!topic && event.summary) {
      const suggested = suggestTopicNameFromSummary(event.summary);
      if (suggested) {
        topic = suggested;
        map.bindSession(ctx.sessionKey, topic);
        await map.save();
        ctx.log.info(`[topic-snapshot] keyword-suggested topic name: "${topic}"`);
      } else {
        topic = map.autoBindSession(ctx.sessionKey);
        await map.save();
      }
    }
    if (!topic) {
      return;
    }

    // If compaction produced a summary, extract decisions/status
    if (event.summary) {
      await TopicSnapshot.updateFromSummary(ctx.workspaceDir, topic, event.summary, ctx.sessionKey);
    }

    await TopicSnapshot.appendHistory(
      ctx.workspaceDir,
      topic,
      `compaction completed (${event.compactedCount} messages compacted)`,
      ctx.sessionKey,
    );

    ctx.log.info(
      `[topic-snapshot] updated after compaction: topic="${topic}" compacted=${event.compactedCount}`,
    );
  } catch (err) {
    ctx.log.warn("[topic-snapshot] after_compaction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── before_reset ───────────────────────────────────────────────────────────────
export async function topicBeforeReset(
  _event: { reason?: string },
  ctx: TopicSnapshotHookContext,
): Promise<void> {
  try {
    if (shouldSkipSession(ctx.sessionKey)) {
      return;
    }

    const map = new TopicMap(ctx.workspaceDir);
    await map.load();

    const topic = map.getTopicForSession(ctx.sessionKey);
    if (!topic) {
      return;
    }

    await TopicSnapshot.appendHistory(
      ctx.workspaceDir,
      topic,
      `auto-saved before reset`,
      ctx.sessionKey,
    );

    ctx.log.info(`[topic-snapshot] saved before reset: topic="${topic}"`);
  } catch (err) {
    ctx.log.warn("[topic-snapshot] before_reset failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── before_prompt_build (inject topic context) ─────────────────────────────────
export async function topicBeforePromptBuild(
  ctx: TopicSnapshotHookContext,
): Promise<string | undefined> {
  try {
    if (shouldSkipSession(ctx.sessionKey)) {
      return undefined;
    }

    const map = new TopicMap(ctx.workspaceDir);
    await map.load();

    const topic = map.getTopicForSession(ctx.sessionKey);
    if (!topic) {
      return undefined;
    }

    const data = await TopicSnapshot.load(ctx.workspaceDir, topic);
    if (!data) {
      return undefined;
    }

    // Only inject if there's meaningful content
    if (!data.status && data.decisions.length === 0 && data.history.length === 0) {
      return undefined;
    }

    return buildInjectionText(data);
  } catch (err) {
    ctx.log.warn("[topic-snapshot] before_prompt_build failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
