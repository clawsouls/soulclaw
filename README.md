# SoulClaw

> Soul-aware OpenClaw fork — enhanced memory, persona, and security for AI agents.
>
> Forked from [OpenClaw](https://github.com/openclaw/openclaw) `main` branch at `v2026.3.1` (MIT License).

SoulClaw is a fork of [OpenClaw](https://github.com/openclaw/openclaw) optimized for the [ClawSouls](https://clawsouls.ai) ecosystem. It adds semantic memory search, persona drift detection, inline security scanning, and native swarm memory synchronization — all running locally.

## ⚡ Killer Feature: Tiered Bootstrap Loading

**Save 40-60% tokens on every conversation.**

OpenClaw loads ALL workspace files (SOUL.md, MEMORY.md, memory/\*.md, TOOLS.md, etc.) into every system prompt — even when you're just asking a quick question. That's thousands of wasted tokens per turn.

SoulClaw introduces **progressive disclosure**: only load what's needed, when it's needed.

| Tier                    | Files                           | When                                          |
| ----------------------- | ------------------------------- | --------------------------------------------- |
| **Tier 1** (Always)     | SOUL.md, IDENTITY.md, AGENTS.md | Every turn — core identity                    |
| **Tier 2** (First turn) | TOOLS.md, USER.md, BOOTSTRAP.md | New session only — session context            |
| **Tier 3** (On demand)  | MEMORY.md, memory/\*.md         | **Never injected** — use `memory_search` tool |

Memory files are available via the `memory_search` tool when actually needed. There's no reason to stuff your entire memory into every system prompt.

```
# Typical savings (Brad agent, 236 memory files):
# OpenClaw:  ~12,000 tokens/turn (all files loaded)
# SoulClaw:  ~4,500 tokens/turn (Tier 1 only on continuation)
# Savings:   ~62% fewer tokens per turn
```

Disable with `SOULCLAW_TIERED_BOOTSTRAP=0` if you want upstream behavior.

## Features

### 🔍 Semantic Memory Search

Vector-based memory retrieval using local Ollama embeddings. Find related memories by meaning, not just keywords.

- Ollama `bge-m3` embeddings (1024d, 100+ languages)
- SQLite + sqlite-vec vector index
- Incremental updates (only re-embed changed chunks)
- Auto-fallback to text matching if Ollama unavailable
- Cross-lingual search (Korean/English)

### 🎭 Persona Engine

Soul Spec-native persona management with drift detection and automatic recovery.

- Soul Spec v0.3 parsing
- Real-time persona drift scoring
- Automatic prompt reinforcement on drift
- Checkpoint-based rollback on severe drift

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
- age encryption transparent handling
- Workspace auto-sync after merge

### 📦 Contained Runtime

Full runtime isolation for embedded environments (VSCode extensions, etc).

- `OPENCLAW_STATE_DIR` respected for all paths including workspace
- No pollution of user's `~/.openclaw/` directory
- Drop-in replacement for OpenClaw

## Installation

```bash
npm install -g soulclaw
```

## Quick Start

```bash
# Start gateway (same as OpenClaw)
soulclaw gateway start

# With contained runtime (for extensions/embedding)
OPENCLAW_STATE_DIR=/path/to/state soulclaw gateway start
```

## Setting Up Ollama for Semantic Memory Search

SoulClaw uses [Ollama](https://ollama.com) for local embedding generation. No API keys needed — everything runs on your machine.

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download from https://ollama.com/download
```

### 2. Pull the embedding model

```bash
ollama pull bge-m3
```

**Why bge-m3?** It's a multilingual embedding model (100+ languages) that handles mixed Korean/English content accurately. Other English-only models (e.g. `nomic-embed-text`) perform poorly on non-English text.

| Model              | Dimensions | Multilingual      | RAM Usage | Recommended             |
| ------------------ | ---------- | ----------------- | --------- | ----------------------- |
| `bge-m3`           | 1024       | ✅ 100+ languages | ~1.3 GB   | ✅ Default              |
| `nomic-embed-text` | 768        | ❌ English only   | ~0.3 GB   | English-only workspaces |

### 3. Verify

```bash
ollama list  # Should show bge-m3
```

That's it. SoulClaw auto-detects Ollama on startup and begins indexing your memory files.

### Hardware Compatibility

| Environment           | Works?           | Speed (per query) |
| --------------------- | ---------------- | ----------------- |
| Apple Silicon (M1-M4) | ✅ GPU via Metal | ~50ms             |
| NVIDIA GPU (CUDA)     | ✅ GPU           | ~30ms             |
| CPU only (no GPU)     | ✅ Works         | ~500ms            |
| Raspberry Pi          | ⚠️ Very slow     | ~3-5s             |

bge-m3 loads on demand and unloads automatically after idle (~17s). Peak RAM: **~1.3 GB** during search, 0 when idle.

### Using a different model

```jsonc
// openclaw.json
{
  "memory": {
    "search": {
      "embedding": {
        "model": "nomic-embed-text", // or any Ollama embedding model
        "ollamaUrl": "http://localhost:11434",
      },
    },
  },
}
```

### Without Ollama

SoulClaw works without Ollama — it falls back to keyword-based text matching (same as standard OpenClaw). Ollama just makes search significantly more accurate.

## Requirements

- Node.js >= 22.12.0
- [Ollama](https://ollama.com) (optional but recommended)
  - `bge-m3` — memory search embeddings (default)
  - Any chat model (e.g. `llama3.2`) — persona drift detection, conflict resolution (future)

## Roadmap

| Milestone | Status      | Description                                            |
| --------- | ----------- | ------------------------------------------------------ |
| v2026.3.3 | ✅ Released | Contained runtime (`OPENCLAW_STATE_DIR` workspace fix) |
| v2026.3.4 | ✅ Released | Semantic memory search (bge-m3 vector embeddings)      |
| v2026.3.5 | ✅ Released | Persona engine + Inline SoulScan + Native Swarm Memory |
| v2026.3.6 | ✅ Released | Tiered bootstrap loading (40-60% token savings)        |
| v2026.5.x | 📋 Future   | Multi-agent orchestration                              |
| v2026.5.x | 📋 Future   | Plugin SDK enhancements                                |

## Upstream Compatibility

SoulClaw is forked from [OpenClaw](https://github.com/openclaw/openclaw) **v2026.3.7** (March 7, 2026).

|                      | Version                |
| -------------------- | ---------------------- |
| **Fork base**        | OpenClaw `2026.3.7`    |
| **Current SoulClaw** | `2026.3.11`            |
| **License**          | MIT (same as OpenClaw) |

All OpenClaw features, plugins, and configurations work as-is. SoulClaw adds functionality — it doesn't remove or break anything.

Universal patches are contributed back to upstream via PR.

## Configuration

SoulClaw works with zero configuration. Advanced options in `openclaw.json`:

```jsonc
{
  "memory": {
    "search": {
      "provider": "vector", // "vector" | "text"
      "embedding": {
        "model": "nomic-embed-text",
        "ollamaUrl": "http://localhost:11434",
      },
    },
  },
}
```

## Ecosystem

SoulClaw is part of the ClawSouls ecosystem:

- [ClawSouls](https://clawsouls.ai) — AI agent persona platform
- [Soul Spec](https://docs.clawsouls.ai) — Open specification for agent identity
- [ClawSouls CLI](https://www.npmjs.com/package/clawsouls) — Soul management, SoulScan, checkpoints, swarm
- [ClawSouls Agent](https://github.com/clawsouls/clawsouls-vscode) — VSCode extension

## License

MIT — same as OpenClaw.

## Credits

Built on [OpenClaw](https://github.com/openclaw/openclaw) by the OpenClaw team.
Enhanced by [ClawSouls](https://clawsouls.ai) for the soul-aware agent ecosystem.
