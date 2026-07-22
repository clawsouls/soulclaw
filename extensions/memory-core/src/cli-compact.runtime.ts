// SoulClaw Soul Memory: `memory compact` archives aged T2 dailies into quarterlies.
import path from "node:path";
import { withMemoryCommand } from "./cli-runtime-common.js";
import { defaultRuntime } from "./cli.host.runtime.js";
import type { MemoryCompactCommandOptions } from "./cli.types.js";

export async function runMemoryCompact(opts: MemoryCompactCommandOptions) {
  await withMemoryCommand({
    commandName: "memory compact",
    agent: opts.agent,
    diagnosticsToStderr: Boolean(opts.json),
    purpose: "status",
    run: async ({ manager }) => {
      const workspaceDir = manager.status().workspaceDir?.trim();
      if (!workspaceDir) {
        defaultRuntime.error("Memory compact requires a resolvable workspace directory.");
        process.exitCode = 1;
        return;
      }
      const memoryDir = path.join(workspaceDir, "memory");
      const { findCompactionCandidates, compactToQuarterly, formatCompactionReport } = await import(
        "./memory/compaction.js"
      );
      const candidates = await findCompactionCandidates(memoryDir, opts.days ?? 90);
      if (opts.apply) {
        const results = await compactToQuarterly(memoryDir, candidates, opts.remove ?? false);
        if (opts.json) {
          defaultRuntime.writeJson({ results });
        } else {
          defaultRuntime.log(formatCompactionReport(candidates, results));
        }
        return;
      }
      if (opts.json) {
        defaultRuntime.writeJson({ candidates });
      } else {
        defaultRuntime.log(formatCompactionReport(candidates));
      }
    },
  });
}
