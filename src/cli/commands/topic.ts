/**
 * Topic management CLI commands
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { TopicMap, TopicSnapshot } from "../../memory/topic-snapshot.js";
import { resolveUserPath } from "../../utils.js";

export function registerTopicCommands(program: Command): void {
  const topic = program.command("topic").description("Manage topic snapshots");

  topic
    .command("list")
    .description("List all topics and session bindings")
    .option("-w, --workspace <path>", "workspace directory", "~/.openclaw/workspace")
    .action(async (opts) => {
      const workspaceDir = resolveUserPath(opts.workspace);

      try {
        const map = new TopicMap(workspaceDir);
        await map.load();

        console.log("📋 Session → Topic Bindings:");

        const mapData = map.getAll();
        if (Object.keys(mapData).length === 0) {
          console.log("  (none yet)");
          return;
        }

        for (const [sessionKey, topicName] of Object.entries(mapData)) {
          console.log(`  ${sessionKey} → ${topicName}`);
        }

        console.log("\n📖 Topic Files:");
        const memoryDir = path.join(workspaceDir, "memory");
        try {
          const files = await fs.readdir(memoryDir);
          const topicFiles = files.filter((f) => f.startsWith("topic-") && f.endsWith(".md"));

          if (topicFiles.length === 0) {
            console.log("  (none yet)");
            return;
          }

          for (const file of topicFiles) {
            const topicName = file.slice(6, -3); // remove "topic-" and ".md"
            const data = await TopicSnapshot.load(workspaceDir, topicName);
            if (data) {
              const decisions = data.decisions.length;
              const history = data.history.length;
              const status = data.status ? data.status.slice(0, 50) + "..." : "(no status)";
              console.log(
                `  ${topicName}: ${decisions} decisions, ${history} history, status: ${status}`,
              );
            }
          }
        } catch {
          console.log("  (memory directory not found)");
        }
      } catch (err) {
        console.error("❌ Error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  topic
    .command("show")
    .description("Show topic content")
    .argument("<name>", "topic name")
    .option("-w, --workspace <path>", "workspace directory", "~/.openclaw/workspace")
    .action(async (name, opts) => {
      const workspaceDir = resolveUserPath(opts.workspace);

      try {
        const data = await TopicSnapshot.load(workspaceDir, name);
        if (!data) {
          console.error(`❌ Topic "${name}" not found`);
          process.exit(1);
        }

        console.log(`📖 Topic: ${data.name}`);
        console.log(`📅 Created: ${data.meta.created} | Updated: ${data.meta.updated}`);
        console.log(`🔗 Session: ${data.meta.session}`);

        if (data.status) {
          console.log(`\n📊 Current Status:`);
          console.log(data.status);
        }

        if (data.decisions.length > 0) {
          console.log(`\n⚖️  Key Decisions (${data.decisions.length}):`);
          for (const decision of data.decisions.slice(-10)) {
            // last 10
            console.log(decision);
          }
          if (data.decisions.length > 10) {
            console.log(`  ... and ${data.decisions.length - 10} more`);
          }
        }

        if (data.history.length > 0) {
          console.log(`\n📝 History (${data.history.length}):`);
          for (const entry of data.history.slice(-10)) {
            // last 10
            console.log(entry);
          }
          if (data.history.length > 10) {
            console.log(`  ... and ${data.history.length - 10} more`);
          }
        }
      } catch (err) {
        console.error("❌ Error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  topic
    .command("bind")
    .description("Bind a session to a topic")
    .argument("<session-key>", "session key (e.g., agent:main:telegram:123)")
    .argument("<topic-name>", "topic name")
    .option("-w, --workspace <path>", "workspace directory", "~/.openclaw/workspace")
    .action(async (sessionKey, topicName, opts) => {
      const workspaceDir = resolveUserPath(opts.workspace);

      try {
        const map = new TopicMap(workspaceDir);
        await map.load();
        map.bindSession(sessionKey, topicName);
        await map.save();

        console.log(`✅ Bound ${sessionKey} → ${topicName}`);
      } catch (err) {
        console.error("❌ Error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  topic
    .command("checkpoint")
    .description("Manually save a topic checkpoint")
    .argument("<session-key>", "session key")
    .argument("<message>", "checkpoint message")
    .option("-w, --workspace <path>", "workspace directory", "~/.openclaw/workspace")
    .action(async (sessionKey, message, opts) => {
      const workspaceDir = resolveUserPath(opts.workspace);

      try {
        const map = new TopicMap(workspaceDir);
        await map.load();

        let topic = map.getTopicForSession(sessionKey);
        if (!topic) {
          topic = map.autoBindSession(sessionKey);
          await map.save();
        }

        await TopicSnapshot.appendHistory(workspaceDir, topic, message, sessionKey);
        console.log(`✅ Checkpointed "${message}" to topic ${topic}`);
      } catch (err) {
        console.error("❌ Error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
