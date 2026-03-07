# SoulClaw

> Soul-aware OpenClaw fork — enhanced memory, persona, and security for AI agents.

SoulClaw is a fork of [OpenClaw](https://github.com/openclaw/openclaw) optimized for the [ClawSouls](https://clawsouls.ai) ecosystem. It adds semantic memory search, persona drift detection, inline security scanning, and native swarm memory synchronization — all running locally.

## Features

### 🔍 Semantic Memory Search

Vector-based memory retrieval using local Ollama embeddings. Find related memories by meaning, not just keywords.

- Ollama `nomic-embed-text` embeddings (768d)
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

# Memory search uses vector index automatically if Ollama is running
ollama pull nomic-embed-text
```

## Requirements

- Node.js >= 22.12.0
- [Ollama](https://ollama.com) (optional, for semantic search + persona features)
  - `nomic-embed-text` — memory search embeddings
  - Any chat model (e.g. `llama3.2`) — persona drift detection, conflict resolution

## Roadmap

| Milestone | Status         | Description                                            |
| --------- | -------------- | ------------------------------------------------------ |
| v2026.3.3 | ✅ Released    | Contained runtime (`OPENCLAW_STATE_DIR` workspace fix) |
| v2026.4.1 | 🔨 In Progress | Semantic memory search (vector embeddings)             |
| v2026.4.2 | 📋 Planned     | Persona engine (drift detection + recovery)            |
| v2026.4.3 | 📋 Planned     | Inline SoulScan (built-in security scanning)           |
| v2026.4.4 | 📋 Planned     | Native swarm memory (auto-sync via heartbeat)          |
| v2026.5.x | 📋 Future      | Context window optimization                            |
| v2026.5.x | 📋 Future      | Multi-agent orchestration                              |
| v2026.5.x | 📋 Future      | Plugin SDK enhancements                                |

## Upstream Compatibility

SoulClaw tracks OpenClaw `main` branch. All OpenClaw features, plugins, and configurations work as-is. SoulClaw adds functionality — it doesn't remove or break anything.

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
