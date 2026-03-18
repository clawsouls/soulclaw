# Migration Guide: OpenClaw → SoulClaw

## Overview

SoulClaw is a drop-in replacement for OpenClaw. Both share the same workspace directory (`~/.openclaw/`), configuration format, and plugin system. Migration takes under 5 minutes with zero data loss.

## Why Migrate?

| Feature                                 | OpenClaw | SoulClaw                  |
| --------------------------------------- | -------- | ------------------------- |
| 3-Tier Long-Term Memory                 | ❌       | ✅ DAG + Passive + Vector |
| Tiered Bootstrap (40-60% token savings) | ❌       | ✅                        |
| Semantic Memory Search (local)          | ❌       | ✅ bge-m3 embeddings      |
| Passive Memory Extraction               | ❌       | ✅ Auto-extract facts     |
| Persona Drift Detection                 | ❌       | ✅                        |
| Inline SoulScan                         | ❌       | ✅                        |

## Prerequisites

- Node.js >= 22.12.0
- Existing OpenClaw installation
- [Ollama](https://ollama.com) (optional, for semantic search)

## Step 1: Stop OpenClaw Gateway

```bash
openclaw gateway stop
```

## Step 2: Install SoulClaw

```bash
npm install -g soulclaw
```

This does NOT touch your existing OpenClaw installation. Both can coexist.

## Step 3: Start SoulClaw Gateway

```bash
soulclaw gateway start
```

That's it. SoulClaw reads the same `~/.openclaw/openclaw.json` config and `~/.openclaw/workspace/` directory.

## Step 4: Enable 3-Tier Memory (Optional)

Add to your `~/.openclaw/openclaw.json`:

```jsonc
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "provider": "local", // enables vector search + DAG + passive memory
      },
    },
  },
}
```

If using Ollama for embeddings:

```bash
ollama pull bge-m3
```

Restart the gateway:

```bash
soulclaw gateway restart
```

## What Gets Preserved

| Data                    | Location                        | Preserved? |
| ----------------------- | ------------------------------- | ---------- |
| Configuration           | `~/.openclaw/openclaw.json`     | ✅ Shared  |
| Workspace files         | `~/.openclaw/workspace/`        | ✅ Shared  |
| SOUL.md, IDENTITY.md    | `~/.openclaw/workspace/`        | ✅ Shared  |
| Memory files            | `~/.openclaw/workspace/memory/` | ✅ Shared  |
| Session history         | `~/.openclaw/sessions/`         | ✅ Shared  |
| Plugins                 | `~/.openclaw/plugins/`          | ✅ Shared  |
| Logs                    | `~/.openclaw/logs/`             | ✅ Shared  |
| Cron jobs               | Config in `openclaw.json`       | ✅ Shared  |
| Telegram/Discord tokens | Config in `openclaw.json`       | ✅ Shared  |

**Everything lives in `~/.openclaw/`** — SoulClaw reads and writes to the same directory. No data migration needed.

## What's New (Created by SoulClaw)

| File                                         | Purpose                    | Created When                                 |
| -------------------------------------------- | -------------------------- | -------------------------------------------- |
| `~/.openclaw/workspace/.dag-memory.sqlite`   | DAG lossless message store | First conversation with memorySearch enabled |
| `~/.openclaw/workspace/.memory-index.sqlite` | Vector embedding index     | First memory_search call                     |

These are additive — they don't modify existing files.

## Rolling Back to OpenClaw

If you need to switch back:

```bash
soulclaw gateway stop
openclaw gateway start
```

OpenClaw will ignore the `.dag-memory.sqlite` and `.memory-index.sqlite` files. Your workspace remains unchanged.

## Running from Source (Development)

If installing from source instead of npm:

```bash
git clone https://github.com/clawsouls/soulclaw.git
cd soulclaw
pnpm install
pnpm build
pnpm ui:build    # ← Required for Control UI dashboard
npm install -g .
soulclaw gateway start
```

> **Note**: `pnpm ui:build` is a separate step. Without it, the gateway dashboard at `http://127.0.0.1:18789/` will show a blank page. This only applies to source installs — npm registry installs include pre-built UI assets.

## LaunchAgent (macOS)

SoulClaw uses the same LaunchAgent name as OpenClaw (`ai.openclaw.gateway`). Installing SoulClaw's gateway service automatically replaces OpenClaw's:

```bash
soulclaw gateway install    # Installs/replaces LaunchAgent
soulclaw gateway start      # Starts the service
```

## Troubleshooting

### Gateway won't start

```bash
soulclaw gateway status    # Check current state
soulclaw doctor            # Run diagnostics
```

### Memory search not working

1. Verify Ollama is running: `ollama list`
2. Check config has `memorySearch.provider` set
3. Restart gateway: `soulclaw gateway restart`

### Control UI blank page (source install only)

```bash
cd /path/to/soulclaw
pnpm ui:build
npm install -g .
soulclaw gateway restart
```

## FAQ

**Q: Can I run both OpenClaw and SoulClaw simultaneously?**
A: Not on the same port. Stop one before starting the other. They share the same config, so port conflicts will occur.

**Q: Will SoulClaw break my OpenClaw config?**
A: No. SoulClaw only adds new fields (e.g., `memorySearch`). OpenClaw ignores fields it doesn't recognize.

**Q: Do I need to re-configure Telegram/Discord/Slack?**
A: No. Channel configuration is shared via `openclaw.json`.

**Q: What about the `soulclaw` vs `openclaw` command?**
A: Both work. `soulclaw` is the recommended command. The `openclaw` command from the original installation still works if installed.
