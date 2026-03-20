---
name: session-memory-autoflush
description: "Automatically saves session context to memory files when sessions end unexpectedly (compaction, timeout, reaper)"
homepage: https://docs.openclaw.ai/automation/hooks#session-memory-autoflush
metadata:
  {
    "openclaw":
      {
        "emoji": "🔄",
        "events": ["session:end"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with OpenClaw" }],
      },
  }
---

# Session Memory Autoflush

Automatically saves session context on unexpected session endings to prevent memory loss.

## What It Does

When a session ends due to compaction, timeout, or reaper cleanup:

1. **Checks the reason** — Skips `command` reason (the `session-memory` hook handles `/new` and `/reset`)
2. **Extracts conversation** — Reads the last 15 user/assistant messages from the session transcript
3. **Saves to memory** — Appends to `<workspace>/memory/YYYY-MM-DD-autoflush.md`

## Output Format

Memory files are appended with the following format:

```markdown
## Autoflush: 2026-01-16 14:30:00 UTC

- **Session Key**: agent:main:main
- **Session ID**: abc123def456
- **Reason**: compaction

### Recent Conversation

user: How do I configure webhooks?
assistant: You can configure webhooks in the settings...
```

## Configuration

| Option           | Type     | Default  | Description                                       |
| ---------------- | -------- | -------- | ------------------------------------------------- |
| `excludeReasons` | string[] | `[]`     | Session end reasons to skip (e.g., `["command"]`) |
| `onFailure`      | string   | `"warn"` | Error behavior: `"warn"`, `"error"`, `"silent"`   |

Example configuration:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "session-memory-autoflush": {
          "enabled": true,
          "excludeReasons": ["command"],
          "onFailure": "warn"
        }
      }
    }
  }
}
```

## Disabling

```bash
openclaw hooks disable session-memory-autoflush
```
