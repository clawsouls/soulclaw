# SoulClaw

> Soul-aware OpenClaw fork — enhanced memory, persona, and security for AI agents.
>
> Forked from [OpenClaw](https://github.com/openclaw/openclaw) (MIT License). Current base: upstream `v2026.8.1` (tag `upstream-v2026.8.1`); the fork started at `v2026.3.1`.

SoulClaw is a fork of [OpenClaw](https://github.com/openclaw/openclaw) optimized for the [ClawSouls](https://clawsouls.ai) ecosystem. It adds a **3-Tier long-term memory system**, semantic memory search, persona drift detection, inline security scanning, and native swarm memory synchronization — all running locally.

## What's new in 2026.8.1

- **Rebuilt on OpenClaw 2.0 (`v2026.8.1`)** — the SoulClaw layer was re-applied on top of the upstream release instead of being merged forward from 2026.7.x, which had fallen ~21k commits behind. You get every 2.0 change: simplified install, SQLite-backed sessions, browser/computer control, shared sessions, the new security model.
- **Upstream memory, used as-is** — OpenClaw 2.0 ships its own built-in memory (plain files + one SQLite index, trust tiers, Active Memory recall, the `memory-wiki` plugin). SoulClaw no longer bundles the 2026.7.x memory engine; it will return as a plugin on top of upstream memory in a follow-up release. The tiered bootstrap loading rules below are unchanged.
- **Carried forward**: persona loading (Soul Spec), inline SoulScan, Soul Rollback, native Swarm Memory sync, `/topic` snapshots, the bundled session hooks and `soulclaw host`.
- **Fixed**: the `session-start-index` hook had been failing silently since 2026.7.x (it imported a path that did not exist in the built bundle); it is wired to the 2.0 memory runtime again.
- **Sessions moved to SQLite** (upstream change) — back up `~/.openclaw` before upgrading from 2026.7.x; sessions created after the migration are not visible to older releases.
- **Node requirement** — Node.js `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0` (see [Requirements](#requirements)).

## 🧠 Soul Memory — transition note for 2026.8.1

OpenClaw 2.0 introduced a built-in memory system that covers most of what SoulClaw's
2026.7.x 4-tier engine did: plain files plus one SQLite index, trust-tiered writes,
per-turn recall with an escalating deep-recall lane (Active Memory), and a compiled
knowledge vault (`memory-wiki`). Rather than run two memory engines side by side,
this release uses upstream memory unchanged and retires the bundled 7.x engine.

What stays SoulClaw-specific — and is unchanged in this release:

- **Tiered bootstrap loading** (next section): which files load always, on first
  response, on demand, and in the background.
- **Swarm Memory**: git-native sync of memory between separate SoulClaw instances.
- **Persona ↔ memory boundary**: memory is not part of the Soul Spec; the persona
  files stay portable on their own.

The SoulClaw memory layer returns as a plugin on top of upstream memory in a
follow-up release. Until then, `memory_search` and the upstream CLI (`openclaw memory`)
are the tools to use.

## ⚡ Tiered Bootstrap Loading

**Save 40-60% tokens on every conversation.**

OpenClaw loads ALL workspace files into every system prompt. SoulClaw introduces **progressive disclosure**:

| Tier                    | Files                           | When                                          |
| ----------------------- | ------------------------------- | --------------------------------------------- |
| **Tier 1** (Always)     | SOUL.md, IDENTITY.md, AGENTS.md | Every turn — core identity                    |
| **Tier 2** (First turn) | TOOLS.md, USER.md, BOOTSTRAP.md | New session only — session context            |
| **Tier 3** (On demand)  | MEMORY.md, memory/\*.md         | **Never injected** — use `memory_search` tool |

```
# Typical savings (236 memory files):
# OpenClaw:  ~12,000 tokens/turn (all files loaded)
# SoulClaw:  ~4,500 tokens/turn (Tier 1 only on continuation)
# Savings:   ~62% fewer tokens per turn
```

Disable with `SOULCLAW_TIERED_BOOTSTRAP=0` if you want upstream behavior.

## Features

### 🔍 Semantic Memory Search

Vector-based memory retrieval using local Ollama embeddings.

- Ollama `bge-m3` embeddings (1024d, 100+ languages)
- SQLite + sqlite-vec vector index
- Incremental updates (only re-embed changed chunks)
- Auto-fallback to text matching if Ollama unavailable
- Cross-lingual search (Korean/English/Japanese/etc.)

### 🎭 Persona Engine

Soul Spec-native persona management with drift detection and automatic recovery.

- Soul Spec v0.3 parsing
- Real-time persona drift scoring
- Automatic prompt reinforcement on drift

### 🛡️ Inline SoulScan

Built-in security scanning — no external CLI dependency.

- 4-stage scanning pipeline (Schema → File → Security → Quality)
- Auto-scan on soul apply
- Risk scoring (0-100)
- Dangerous soul blocking

### 🔄 Native Swarm Memory

Automatic agent memory synchronization via heartbeat.

- Auto pull/push on heartbeat cycle
- LLM-based conflict resolution
- Workspace auto-sync after merge

### 📦 Contained Runtime

Full runtime isolation for embedded environments (VSCode extensions, etc).

- `OPENCLAW_STATE_DIR` respected for all paths including workspace
- No pollution of user's `~/.openclaw/` directory
- Drop-in replacement for OpenClaw

## Installation

### npm

```bash
npm install -g soulclaw
```

This installs SoulClaw `2026.8.1` (rebased onto OpenClaw v2026.8.1). Requires Node.js `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0`.

### From source

```bash
git clone https://github.com/clawsouls/soulclaw.git
cd soulclaw
pnpm install
node scripts/build-all.mjs
node openclaw.mjs --version
```

## Quick Start

```bash
# Start gateway
soulclaw gateway start

# With contained runtime (for extensions/embedding)
OPENCLAW_STATE_DIR=/path/to/state soulclaw gateway start
```

## Security defaults (DM access)

OpenClaw connects to real messaging surfaces. Treat inbound DMs as **untrusted input**.

Full security guide: [Security](https://docs.openclaw.ai/gateway/security).
Before remote exposure, use the [Gateway exposure runbook](https://docs.openclaw.ai/gateway/security/exposure-runbook).

Default behavior on Telegram/WhatsApp/Signal/iMessage/Microsoft Teams/Discord/Google Chat/Slack:

- **DM pairing** (`dmPolicy="pairing"` / `channels.discord.dmPolicy="pairing"` / `channels.slack.dmPolicy="pairing"`; legacy: `channels.discord.dm.policy`, `channels.slack.dm.policy`): unknown senders receive a short pairing code and the bot does not process their message.
- Approve with: `openclaw pairing approve <channel> <code>` (then the sender is added to a local allowlist store).
- Public inbound DMs require an explicit opt-in: set `dmPolicy="open"` and include `"*"` in the channel allowlist (`allowFrom` / `channels.discord.allowFrom` / `channels.slack.allowFrom`; legacy: `channels.discord.dm.allowFrom`, `channels.slack.dm.allowFrom`).

Run `openclaw doctor` to surface risky/misconfigured DM policies.

## Highlights

- **[Local-first Gateway](https://docs.openclaw.ai/gateway)** — single control plane for sessions, channels, tools, and events.
- **[Multi-channel inbox](https://docs.openclaw.ai/channels)** — WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, IRC, Microsoft Teams, Matrix, Feishu, LINE, Mattermost, Nextcloud Talk, Nostr, Synology Chat, Tlon, Twitch, Zalo, Zalo Personal, WeChat, QQ, WebChat, macOS, iOS/Android.
- **[Multi-agent routing](https://docs.openclaw.ai/gateway/configuration)** — route inbound channels/accounts/peers to isolated agents (workspaces + per-agent sessions).
- **[Voice Wake](https://docs.openclaw.ai/nodes/voicewake) + [Talk Mode](https://docs.openclaw.ai/nodes/talk)** — wake words on macOS/iOS and continuous voice on Android (ElevenLabs + system TTS fallback).
- **[Live Canvas](https://docs.openclaw.ai/platforms/mac/canvas)** — agent-driven visual workspace with [A2UI](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui).
- **[First-class tools](https://docs.openclaw.ai/tools)** — browser, canvas, nodes, cron, sessions, and Discord/Slack actions.
- **[Companion apps](https://docs.openclaw.ai/platforms)** — Windows Hub, macOS menu bar app, and iOS/Android [nodes](https://docs.openclaw.ai/nodes).
- **[Onboarding](https://docs.openclaw.ai/start/wizard) + [skills](https://docs.openclaw.ai/tools/skills)** — onboarding-driven setup with bundled/managed/workspace skills.

## Security model (important)

- Default: tools run on the host for the `main` session, so the agent has full access when it is just you.
- Group/channel safety: set `agents.defaults.sandbox.mode: "non-main"` to run non-`main` sessions inside sandboxes. Docker is the default sandbox backend; SSH and OpenShell backends are also available.
- Typical sandbox default: allow `bash`, `process`, `read`, `write`, `edit`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`; deny `browser`, `canvas`, `nodes`, `cron`, `discord`, `gateway`.
- Before exposing anything remotely, read [Security](https://docs.openclaw.ai/gateway/security), [Gateway exposure runbook](https://docs.openclaw.ai/gateway/security/exposure-runbook), [Sandboxing](https://docs.openclaw.ai/gateway/sandboxing), and [Configuration](https://docs.openclaw.ai/gateway/configuration).

## Operator quick refs

- Chat commands: `/status`, `/new`, `/reset`, `/compact`, `/think <level>`, `/verbose on|off`, `/trace on|off`, `/usage off|tokens|full`, `/restart`, `/activation mention|always`
- Session tools: `sessions_list`, `sessions_history`, `sessions_send`
- Skills registry: [ClawHub](https://clawhub.ai)
- Architecture overview: [Architecture](https://docs.openclaw.ai/concepts/architecture)

## Docs by goal

- New here: [Getting started](https://docs.openclaw.ai/start/getting-started), [Onboarding](https://docs.openclaw.ai/start/wizard), [Updating](https://docs.openclaw.ai/install/updating)
- Channel setup: [Channels index](https://docs.openclaw.ai/channels), [WhatsApp](https://docs.openclaw.ai/channels/whatsapp), [Telegram](https://docs.openclaw.ai/channels/telegram), [Discord](https://docs.openclaw.ai/channels/discord), [Slack](https://docs.openclaw.ai/channels/slack)
- Apps + nodes: [Windows Hub](https://docs.openclaw.ai/platforms/windows), [macOS](https://docs.openclaw.ai/platforms/macos), [iOS](https://docs.openclaw.ai/platforms/ios), [Android](https://docs.openclaw.ai/platforms/android), [Nodes](https://docs.openclaw.ai/nodes)
- Config + security: [Configuration](https://docs.openclaw.ai/gateway/configuration), [Security](https://docs.openclaw.ai/gateway/security), [Exposure runbook](https://docs.openclaw.ai/gateway/security/exposure-runbook), [Sandboxing](https://docs.openclaw.ai/gateway/sandboxing)
- Remote + web: [Gateway](https://docs.openclaw.ai/gateway), [Remote access](https://docs.openclaw.ai/gateway/remote), [Tailscale](https://docs.openclaw.ai/gateway/tailscale), [Web surfaces](https://docs.openclaw.ai/web)
- Tools + automation: [Tools](https://docs.openclaw.ai/tools), [Skills](https://docs.openclaw.ai/tools/skills), [Cron jobs](https://docs.openclaw.ai/automation/cron-jobs), [Webhooks](https://docs.openclaw.ai/automation/webhook), [Gmail Pub/Sub](https://docs.openclaw.ai/automation/gmail-pubsub)
- Internals: [Architecture](https://docs.openclaw.ai/concepts/architecture), [Agent](https://docs.openclaw.ai/concepts/agent), [Session model](https://docs.openclaw.ai/concepts/session), [Gateway protocol](https://docs.openclaw.ai/reference/rpc)
- Troubleshooting: [Channel troubleshooting](https://docs.openclaw.ai/channels/troubleshooting), [Logging](https://docs.openclaw.ai/logging), [Docs home](https://docs.openclaw.ai)

## Apps (optional)

The Gateway alone delivers a great experience. All apps are optional and add extra features.

If you plan to build/run companion apps, follow the platform runbooks below.

### macOS (OpenClaw.app) (optional)

- Menu bar control for the Gateway and health.
- Voice Wake + push-to-talk overlay.
- WebChat + debug tools.
- Remote gateway control over SSH.

Note: signed builds required for macOS permissions to stick across rebuilds (see [macOS Permissions](https://docs.openclaw.ai/platforms/mac/permissions)).

### iOS node (optional)

- Pairs as a node over the Gateway WebSocket (device pairing).
- Voice trigger forwarding + Canvas surface.
- Controlled via `openclaw nodes …`.

### Android node (optional)

- Pairs as a WS node via device pairing (`openclaw devices ...`).
- Exposes Connect/Chat/Voice tabs plus Canvas, Camera, Screen capture, and Android device command families.
- Runbook: [Android connect](https://docs.openclaw.ai/platforms/android).

## Setting Up Ollama for Memory Search

SoulClaw uses [Ollama](https://ollama.com) for local embedding generation. No API keys needed.

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull the embedding model

```bash
ollama pull bge-m3
```

**Why bge-m3?** Multilingual embedding model (100+ languages) that handles mixed-language content accurately.

| Model              | Dimensions | Multilingual      | RAM    | Recommended             |
| ------------------ | ---------- | ----------------- | ------ | ----------------------- |
| `bge-m3`           | 1024       | ✅ 100+ languages | ~1.3GB | ✅ Default              |
| `nomic-embed-text` | 768        | ❌ English only   | ~0.3GB | English-only workspaces |

### 3. Verify

```bash
ollama list  # Should show bge-m3
```

SoulClaw auto-detects Ollama on startup and begins indexing memory files.

### Hardware Compatibility

| Environment           | Speed (per query) |
| --------------------- | ----------------- |
| Apple Silicon (M1-M4) | ~50ms (Metal GPU) |
| NVIDIA GPU (CUDA)     | ~30ms             |
| CPU only              | ~500ms            |

### Using a different embedding model

```jsonc
// openclaw.json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "provider": "local",
        "embedding": {
          "model": "nomic-embed-text",
          "ollamaUrl": "http://localhost:11434",
        },
      },
    },
  },
}
```

### Without Ollama

SoulClaw works without Ollama — it falls back to keyword-based text matching. Ollama makes search significantly more accurate.

## Roadmap

| Tag                              | Status        | Description                                                                                       |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `soulclaw/v2026.8.1`             | 🚧 Publishing | Rebuilt on OpenClaw 2.0 (v2026.8.1); upstream memory used as-is, 7.x engine retired               |
| `soulclaw/v2026.3.3`             | ✅ Released   | Contained runtime (`OPENCLAW_STATE_DIR` workspace fix)                                            |
| `soulclaw/v2026.3.4`             | ✅ Released   | Semantic memory search (bge-m3 vector embeddings)                                                 |
| `soulclaw/v2026.3.5`             | ✅ Released   | Persona engine + Inline SoulScan + Native Swarm Memory                                            |
| `soulclaw/v2026.3.6`             | ✅ Released   | Tiered bootstrap loading (40-60% token savings)                                                   |
| `soulclaw/v2026.3.12`            | ✅ Released   | Stability improvements + upstream sync                                                            |
| `soulclaw/v2026.3.17`            | ✅ Released   | Passive memory auto-extraction                                                                    |
| `soulclaw/v2026.3.18`            | ✅ Released   | DAG lossless memory store (SQLite + FTS5)                                                         |
| `soulclaw/v2026.3.19`            | ✅ Released   | DAG FTS5 → memory_search pipeline integration                                                     |
| `soulclaw/v2026.3.20`            | ✅ Released   | Network stability fix (IPv6 auto-fallback)                                                        |
| `soulclaw/v2026.3.21–v2026.3.37` | ✅ Released   | Topic snapshots, compaction notify, session hooks, `soulclaw host`, stability                     |
| `soulclaw/v2026.8.1`             | 🔄 Tagging    | Rebase onto OpenClaw v2026.8.1 — extensions architecture, dreaming, video/music, memory-core port |

## Upstream Compatibility

|                      | Version                            |
| -------------------- | ---------------------------------- |
| **Fork base**        | OpenClaw `v2026.3.1` (main branch) |
| **Current SoulClaw** | `2026.8.1`                         |
| **License**          | MIT (same as OpenClaw)             |

All OpenClaw features, plugins, and configurations work as-is. SoulClaw adds functionality — it doesn't remove or break anything.

The `openclaw/main` branch tracks upstream for migration purposes.

## Requirements

- Node.js `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0` (upstream requirement)
- [Ollama](https://ollama.com) (optional but recommended)
  - `bge-m3` — memory search embeddings (default)

## Ecosystem

SoulClaw is part of the ClawSouls ecosystem:

- [ClawSouls](https://clawsouls.ai) — AI agent persona platform
- [Soul Spec](https://docs.clawsouls.ai) — Open specification for agent identity
- [SoulClaw CLI Guide](https://docs.clawsouls.ai/docs/platform/soulclaw-cli) — Detailed usage guide (SoulScan, Persona Engine, Swarm Memory)
- [ClawSouls CLI](https://www.npmjs.com/package/clawsouls) — Soul management, SoulScan, checkpoints

## License

MIT — same as OpenClaw.

## Credits

Built on [OpenClaw](https://github.com/openclaw/openclaw) by the OpenClaw team.
Enhanced by [ClawSouls](https://clawsouls.ai) for the soul-aware agent ecosystem.
