# SoulClaw Migration — OpenClaw v2026.3.37 → v2026.7.1

Working notes for the 2026-07-22 migration. Base: upstream `v2026.7.1` (stable, 2026-07-13).
Previous SoulClaw: `soulclaw/v2026.3.37` (fa4cd61, 2026-03-27) + 2 cherry-picks (2026-04-02).

## Upstream changes that matter (2026.3.37 → 2026.7.1)

- **Monorepo restructure**: 6.5K → 22K files. `extensions/` plugin architecture (providers, channels, memory are now extensions), `packages/` shared libs.
- `src/agents/pi-embedded-runner/` → `src/agents/embedded-agent-runner/` (285 files) + `src/agents/agent-hooks/` (new hook infra incl. `compaction-instructions.ts`, `compaction-safeguard-quality.ts`).
- Memory core → `extensions/memory-core/` (has `dreaming-command.ts`, `concept-vocabulary.ts` — upstream built memory synthesis) + thin `extensions/active-memory/`.
- `src/gateway/server-startup.ts` → split into `server-startup-{config,early,log,memory}.ts`.
- `src/terminal/theme.ts` → `packages/terminal-core/src/theme.ts`.
- `src/wizard/onboarding.ts` → moved (matrix ext has its own; core onboarding location TBD in Phase 2).

## Carry-over status (Phase 1)

- 64 SoulClaw-new files restored onto v2026.7.1 (Soul Memory engines, SoulScan, Persona Engine, Swarm Memory, tiered-bootstrap, topic-snapshot, compaction-notify, clawsouls skill, docs). `.omc/` session noise intentionally dropped. `src/soulscan/rules.ts` skipped (deleted later in our own history).
- 41 files that exist in both: our diffs applied 3-way (see conflict list in work log).

## Phase 2 — integration points to port (12 files, old → new)

| Our change (old location)                                                                                        | New location / approach                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/pi-embedded-runner/compact.ts`, `run.ts`, `run/attempt.ts` (compaction-notify wiring, session hooks) | `src/agents/embedded-agent-runner/` + evaluate `src/agents/agent-hooks/` — upstream now HAS compaction hook infra; prefer adopting upstream hooks and plugging our Telegram notify into them |
| `src/agents/tools/memory-tool.ts` (memory_search/memory_get DAG FTS5)                                            | `extensions/memory-core` tool surface — port DAG FTS5 + bge-m3 semantic into memory-core ext, or ship as our own `extensions/soul-memory`                                                    |
| `src/cli/memory-cli.ts` (memory promote etc.)                                                                    | `extensions/memory-core/cli.ts` metadata pattern                                                                                                                                             |
| `src/gateway/server-startup.ts` (SoulScan/Persona/Swarm pipeline wiring)                                         | `server-startup-*.ts` split — wire into `server-startup-config.ts`/`early.ts` equivalents                                                                                                    |
| `src/memory/{index,manager,manager-sync-ops,search-manager}.ts`                                                  | `extensions/memory-core/src/memory/` — port our deltas onto moved files                                                                                                                      |
| `src/terminal/theme.ts` (soulclaw theme keys)                                                                    | `packages/terminal-core/src/theme.ts`                                                                                                                                                        |
| `src/wizard/onboarding.ts` (soul selection, bge-m3 default, memory dir)                                          | locate new core onboarding; port steps                                                                                                                                                       |

## Decisions to make (Phase 2)

1. **Soul Memory vs upstream memory-core/dreaming**: upstream now has memory synthesis ("dreaming") + concept vocabulary. Decide per-feature: adopt upstream + layer Soul-specific parts (tiering, promotion, DAG lossless) vs keep ours parallel. Bias: adopt upstream infra, keep our differentiators (3-tier, T2→T1 promotion, DAG FTS5, bge-m3 default) as the SoulClaw layer.
2. **Session lifecycle hooks**: upstream `agent-hooks` may cover session:start/end — if so, drop our implementation, keep our consumers.
3. **Extension vs in-tree**: consider packaging SoulScan/Persona/Swarm/Soul Memory as `extensions/soul-*` to ride the new plugin architecture (cleaner future migrations).

## Tag & release

- Tag after verification: `soulclaw/v2026.7.1`.
- Verify checklist: build green, `soulclaw` CLI banner/branding, onboarding soul selection, memory_search (semantic+FTS5), soulscan/persona/swarm CLIs, /topic, compaction notify, `soulclaw host`, gateway boots, Telegram channel up.
