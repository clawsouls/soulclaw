# SoulClaw

> Soul-aware OpenClaw fork — enhanced memory, persona, and security for AI agents.
>
> Forked from [OpenClaw](https://github.com/openclaw/openclaw) `main` branch at `v2026.3.1` (MIT License).

SoulClaw is a fork of [OpenClaw](https://github.com/openclaw/openclaw) optimized for the [ClawSouls](https://clawsouls.ai) ecosystem. It adds a **3-Tier long-term memory system**, semantic memory search, persona drift detection, inline security scanning, and native swarm memory synchronization — all running locally.

## 🧠 Soul Memory — 4-Tier Adaptive Memory Architecture

SoulClaw agents **never forget** while maintaining coherent identity. Soul Memory separates identity from experience through a 4-tier hierarchy with temporal decay and automatic promotion:

```
┌─────────────────────────────────────────────┐
│  T0: SOUL (Identity)                        │
│  SOUL.md, IDENTITY.md                       │
│  Immutable. Human-authorized changes only.  │
│  "Who I am"                                 │
├─────────────────────────────────────────────┤
│  T1: CORE MEMORY (Evergreen)                │
│  MEMORY.md, memory/roadmap.md, etc.         │
│  No decay. Curated knowledge.               │
│  "What I must never forget"                 │
├─────────────────────────────────────────────┤
│  T2: WORKING MEMORY (Temporal)              │
│  memory/2026-03-19.md (dated files)         │
│  Decay: half-life 23 days.                  │
│  "What happened recently"                   │
├─────────────────────────────────────────────┤
│  T3: SESSION MEMORY (Ephemeral)             │
│  Current conversation context.              │
│  Gone after session ends.                   │
│  "What we're talking about right now"       │
└─────────────────────────────────────────────┘
```

### T0: Soul (Identity)

Your agent's `SOUL.md` and `IDENTITY.md`. These define _who the agent is_ — personality, values, behavioral rules. They're loaded fresh every session, never modified by the agent, and never subject to search decay.

**Defense against Memory-Identity Paradox**: No matter how much experience accumulates, the identity anchor remains unchanged.

### T1: Core Memory (Evergreen)

`MEMORY.md` and undated topic files (`memory/roadmap.md`, `memory/legal.md`). These store curated, long-term knowledge: decisions, architecture choices, key relationships, strategies.

**No temporal decay.** Core memories are always at full relevance, whether they were written today or a year ago.

### T2: Working Memory (Temporal)

Date-stamped files like `memory/2026-03-19.md`. These are daily work logs, debug notes, meeting records, task progress.

**Temporal decay with 23-day half-life**: Today's working memory has full relevance. Last week's has 81%. Last month's has 41%. Three months ago? 7%.

Important working memories are automatically promoted to Core Memory (T1) based on:

- Rule-based detection (decisions, architecture, financial, legal terms)
- Access frequency (memories retrieved 3+ times across sessions)
- Weekly review with human approval

### Configuration

Soul Memory activates with embedding provider + temporal decay:

```jsonc
// openclaw.json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "provider": "ollama", // "ollama" | "openai" | "gemini"
        "model": "bge-m3", // Recommended: multilingual
        "query": {
          "hybrid": {
            "temporalDecay": {
              "enabled": true,
              "halfLifeDays": 23, // 23-day half-life for T2
            },
          },
        },
      },
    },
  },
}
```

### Memory Promotion CLI

Scan for promotion candidates:

```bash
openclaw memory promote --days 7          # Last 7 days
openclaw memory promote --frequency       # Show frequently accessed
```

Execute promotions:

```bash
openclaw memory promote --apply           # Auto-promote to MEMORY.md
openclaw memory promote --apply --target memory/legal.md  # Specific file
```

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
