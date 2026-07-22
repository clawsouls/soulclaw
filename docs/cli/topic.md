---
title: topic
description: Manage topic snapshots — auto-saved session context
---

# `soulclaw topic`

Manage **topic snapshots** — structured context that persists across compaction and reset events.

Topic snapshots automatically capture session decisions, status, and history before compaction or reset, ensuring important context is never lost. They are also auto-injected into prompts so the agent can recall past work.

## Subcommands

### `soulclaw topic list`

List all topic bindings and topic files.

```bash
soulclaw topic list
```

**Output:**

```
📋 Session → Topic Bindings:
  agent:main:telegram:123 → hosting
  agent:main:discord:456 → papers

📖 Topic Files:
  hosting: 9 decisions, 4 history, status: Phase 1 complete...
  papers: 4 decisions, 3 history, status: Paper 1 published...
```

### `soulclaw topic show <name>`

Show the content of a topic snapshot.

```bash
soulclaw topic show hosting
```

**Output:**

```
📖 Topic: hosting
📅 Created: 2026-03-22 | Updated: 2026-03-22
🔗 Session: agent:main:telegram:123

📊 Current Status:
Phase 1 complete. Docker image deployed.

⚖️  Key Decisions (3):
- 2026-03-22: BYOK model confirmed
- 2026-03-22: Per-agent pricing $14.99/mo

📝 History (2):
- 2026-03-22: auto-saved before compaction (150 messages)
- 2026-03-22: compaction completed (120 messages compacted)
```

### `soulclaw topic bind <session-key> <topic-name>`

Bind a session to a named topic. All future compaction/reset events for this session will update the bound topic.

```bash
soulclaw topic bind "agent:main:telegram:123" "hosting"
```

### `soulclaw topic checkpoint <session-key> <message>`

Manually save a checkpoint message to the topic bound to a session.

```bash
soulclaw topic checkpoint "agent:main:telegram:123" "Phase 1 deployment complete"
```

## Chat Commands

Topic snapshots can also be managed from within a chat session:

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `/topic`             | Show the current session's bound topic |
| `/topic list`        | List all topic bindings                |
| `/topic bind <name>` | Bind the current session to a topic    |
| `/topic show <name>` | Show a specific topic's content        |

## How It Works

### Automatic Lifecycle

1. **Before compaction**: A history entry is appended to the bound topic (`auto-saved before compaction`)
2. **After compaction**: Decisions and status are extracted from the compaction summary and merged into the topic
3. **Before reset**: A history entry is appended (`auto-saved before reset`)
4. **Prompt build**: The topic's content is injected into the system prompt with a safety header

### Topic File Format

Topic files are stored as Markdown in `workspace/memory/topic-{name}.md`:

```markdown
# hosting

## Meta

- **created**: 2026-03-22
- **updated**: 2026-03-22
- **session**: agent:main:telegram:123

## Current Status

Phase 1 complete. Docker deployed.

## Key Decisions

- 2026-03-22: BYOK model confirmed
- 2026-03-22: Per-agent pricing

## History

- 2026-03-22: auto-saved before compaction (150 messages)
```

### Pruning Rules

- **Key Decisions**: max 50 entries (FIFO — oldest removed first)
- **History**: max 30 entries (FIFO)
- **Current Status**: overwritten on each compaction

### Topic Binding

Sessions are bound to topics in `workspace/memory/topic-map.json`:

```json
{
  "agent:main:telegram:123": "hosting",
  "agent:main:discord:456": "papers"
}
```

If no topic is explicitly bound, the system will:

1. Try to suggest a topic name from the compaction summary keywords
2. Fall back to a sanitized version of the session key

### Zero LLM Cost

Topic snapshots use **zero additional LLM calls**. Decisions and status are extracted from compaction summaries using regex parsing only.

## Options

| Option                   | Description         | Default                 |
| ------------------------ | ------------------- | ----------------------- |
| `-w, --workspace <path>` | Workspace directory | `~/.openclaw/workspace` |

## Related

- [memory](/cli/memory) — Search and reindex memory files
- [hooks](/cli/hooks) — Plugin hook system
