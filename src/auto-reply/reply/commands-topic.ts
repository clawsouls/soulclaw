/**
 * /topic chat command handler
 *
 * Usage:
 *   /topic bind <name>     — Bind current session to a topic
 *   /topic show [name]     — Show topic content (current or named)
 *   /topic list            — List all topics
 *   /topic                 — Show current topic
 */

import { TopicMap, TopicSnapshot } from "../../memory/topic-snapshot.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

export const handleTopicCommand: CommandHandler = async (
  params,
  _allowTextCommands,
): Promise<CommandHandlerResult | null> => {
  const body = params.command.commandBodyNormalized;
  const match = body.match(/^\/topic(?:\s+(.*))?$/i);
  if (!match) {
    return null;
  }

  const args = (match[1] ?? "").trim();
  const parts = args.split(/\s+/).filter(Boolean);
  const action = parts[0]?.toLowerCase() ?? "show";
  const workspaceDir = params.workspaceDir;
  const sessionKey = params.sessionKey;

  const map = new TopicMap(workspaceDir);
  await map.load();

  // /topic bind <name>
  if (action === "bind" && parts[1]) {
    const topicName = parts[1];
    map.bindSession(sessionKey, topicName);
    await map.save();
    return {
      shouldContinue: false,
      reply: { text: `✅ Session bound to topic **${topicName}**` },
    };
  }

  // /topic list
  if (action === "list") {
    const allBindings = map.getAll();
    const entries = Object.entries(allBindings);
    if (entries.length === 0) {
      return {
        shouldContinue: false,
        reply: { text: "📋 No topic bindings yet. Use `/topic bind <name>` to create one." },
      };
    }
    const lines = entries.map(([sk, tn]) => {
      const isCurrent = sk === sessionKey ? " ← current" : "";
      return `• \`${sk}\` → **${tn}**${isCurrent}`;
    });
    return {
      shouldContinue: false,
      reply: { text: `📋 **Topic Bindings:**\n${lines.join("\n")}` },
    };
  }

  // /topic show [name] or /topic (no args)
  const topicName =
    action === "show"
      ? (parts[1] ?? map.getTopicForSession(sessionKey))
      : map.getTopicForSession(sessionKey);

  if (!topicName) {
    return {
      shouldContinue: false,
      reply: { text: "❌ No topic bound to this session. Use `/topic bind <name>` first." },
    };
  }

  const data = await TopicSnapshot.load(workspaceDir, topicName);
  if (!data) {
    return {
      shouldContinue: false,
      reply: { text: `❌ Topic **${topicName}** not found.` },
    };
  }

  const statusText = data.status ? `\n📊 **Status:**\n${data.status}` : "";
  const decisionsText =
    data.decisions.length > 0
      ? `\n⚖️ **Decisions (${data.decisions.length}):**\n${data.decisions.slice(-5).join("\n")}`
      : "";
  const historyText =
    data.history.length > 0
      ? `\n📝 **History (${data.history.length}):**\n${data.history.slice(-5).join("\n")}`
      : "";

  return {
    shouldContinue: false,
    reply: {
      text: `📖 **Topic: ${data.name}**\n📅 Updated: ${data.meta.updated}${statusText}${decisionsText}${historyText}`,
    },
  };
};
