---
name: session-start-index
description: "Runs incremental memory index when a new agent session starts"
homepage: https://docs.openclaw.ai/automation/hooks#session-start-index
metadata:
  {
    "openclaw":
      {
        "emoji": "📇",
        "events": ["session:start"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with OpenClaw" }],
      },
  }
---

# Session Start Index

Runs an incremental memory index when a new agent session starts, ensuring recent memory files are searchable.

## What It Does

When a session starts:

1. **Resolves workspace** — Finds the workspace directory from session context
2. **Runs incremental sync** — Calls the memory manager's `syncMemoryFiles` to index any new or changed memory files
3. **Times out gracefully** — Skips silently if indexing takes longer than 5 seconds

## Configuration

| Option      | Type   | Default | Description                    |
| ----------- | ------ | ------- | ------------------------------ |
| `timeoutMs` | number | `5000`  | Max time for incremental index |

Example configuration:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "session-start-index": {
          "enabled": true,
          "timeoutMs": 3000
        }
      }
    }
  }
}
```

## Disabling

```bash
openclaw hooks disable session-start-index
```
