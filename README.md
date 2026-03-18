# SoulClaw

> Soul-aware OpenClaw fork — enhanced memory, persona, and security for AI agents.
>
> Forked from [OpenClaw](https://github.com/openclaw/openclaw) `main` branch at `v2026.3.1` (MIT License).

SoulClaw is a fork of [OpenClaw](https://github.com/openclaw/openclaw) optimized for the [ClawSouls](https://clawsouls.ai) ecosystem. It adds a **3-Tier long-term memory system**, semantic memory search, persona drift detection, inline security scanning, and native swarm memory synchronization — all running locally.

## 🧠 3-Tier Long-Term Memory System

SoulClaw agents **never forget**. Every conversation is preserved, indexed, and searchable through a 3-tier architecture:

```
User message → Agent processes → Response generated
                                       ↓
                              ┌────────┴────────┐
                              ↓                  ↓
                     Layer 0: DAG Store    Layer 1: Passive Memory
                    (raw messages →        (extract important
                     SQLite + FTS5)         facts → memory/*.md)
                              ↓                  ↓
                              └────────┬────────┘
                                       ↓
                              Layer 2: Semantic Vector Index
                              (embed memory files + FTS5 DAG search)
                                       ↓
                              3-Tier Retrieval on next memory_search
```

### Layer 0 — DAG Lossless Store

Every message is stored verbatim in a SQLite DAG (Directed Acyclic Graph) with FTS5 full-text search. Nothing is ever lost.

- **SQLite + FTS5** — keyword search across entire conversation history
- **Hierarchical summarization** — every 10 turns auto-summarized into higher-level nodes
- **Level 0** = raw messages, **Level 1+** = compressed summaries
- **Zero config** — activates automatically when `memorySearch` is configured

### Layer 1 — Passive Memory

After each conversation turn, the agent silently extracts important facts — decisions, preferences, names, dates — and writes them to `memory/*.md` files. No explicit "remember this" needed.

### Layer 2 — Semantic Vector Search

Memory files are embedded using local Ollama models (bge-m3) and indexed in a SQLite vector store. When `memory_search` is called:

1. **FTS5** searches the DAG for exact keyword matches across all history
2. **Semantic search** finds conceptually related memories from indexed files
3. Results are **merged and deduplicated** — both precision and recall

### Configuration

The entire 3-tier system activates with a single config:

```jsonc
// openclaw.json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "provider": "local", // "local" | "openai" | "gemini"
      },
    },
  },
}
```

That's it. DAG storage, passive memory extraction, and vector indexing all start automatically.

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

```bash
npm install -g soulclaw
```

## Quick Start

```bash
# Start gateway
soulclaw gateway start

# With contained runtime (for extensions/embedding)
OPENCLAW_STATE_DIR=/path/to/state soulclaw gateway start
```

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

| Tag                   | Status      | Description                                            |
| --------------------- | ----------- | ------------------------------------------------------ |
| `soulclaw/v2026.3.3`  | ✅ Released | Contained runtime (`OPENCLAW_STATE_DIR` workspace fix) |
| `soulclaw/v2026.3.4`  | ✅ Released | Semantic memory search (bge-m3 vector embeddings)      |
| `soulclaw/v2026.3.5`  | ✅ Released | Persona engine + Inline SoulScan + Native Swarm Memory |
| `soulclaw/v2026.3.6`  | ✅ Released | Tiered bootstrap loading (40-60% token savings)        |
| `soulclaw/v2026.3.12` | ✅ Released | Stability improvements + upstream sync                 |
| `soulclaw/v2026.3.17` | ✅ Released | Passive memory auto-extraction                         |
| `soulclaw/v2026.3.18` | ✅ Released | DAG lossless memory store (SQLite + FTS5)              |
| `soulclaw/v2026.3.19` | ✅ Released | DAG FTS5 → memory_search pipeline integration          |
| `soulclaw/v2026.3.20` | ✅ Released | Network stability fix (IPv6 auto-fallback)             |

## Upstream Compatibility

|                      | Version                            |
| -------------------- | ---------------------------------- |
| **Fork base**        | OpenClaw `v2026.3.1` (main branch) |
| **Current SoulClaw** | `2026.3.20`                        |
| **License**          | MIT (same as OpenClaw)             |

All OpenClaw features, plugins, and configurations work as-is. SoulClaw adds functionality — it doesn't remove or break anything.

The `openclaw/main` branch tracks upstream for migration purposes.

## Requirements

- Node.js >= 22.12.0
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
