---
name: release-openclaw-announcement
description: "Draft or post OpenClaw beta/stable Discord release announcements from changelog, GitHub release, npm, and validation evidence. Use when announcing a beta, stable release, release candidate, or asking what users should test after an OpenClaw release."
---

# OpenClaw Release Announcement

Use with `release-openclaw-maintainer` after a beta or stable release is live.
Use with `openclaw-discord` when actually posting to Discord.

## Evidence First

Before drafting focus areas, read real release evidence:

1. Current GitHub release body for the tag.
2. `CHANGELOG.md` section for the released base version.
3. Commits since the previous shipped version or the operator-specified base.
4. npm package metadata for the exact version and current dist-tag.
5. Validation status that is relevant to user confidence.

Do not claim a full changelog audit unless you did it. If you only read the
generated release notes or top changelog section, say that and either audit
properly or draft with that limitation.

For beta focus areas, prioritize user-observable changes over internal test or
CI mechanics:

- install/update paths
- OS/platform-specific behavior
- channels and media paths
- provider/model/runtime routing
- Gateway startup/restart and config behavior
- plugin loading and local plugin development
- security/data-loss/user-impact fixes

## Required Copy

Every beta announcement must make beta status explicit and include:

- exact version, e.g. `OpenClaw 2026.5.25-beta.1`
- one-sentence risk framing: beta, useful for testing, not stable promotion
- focused test areas derived from evidence, not guesswork
- update command promoted near the top:
  ```sh
  openclaw update --channel beta --yes
  openclaw --version
  ```
- fresh install path:
  `Install from https://openclaw.ai or npm with npm install -g openclaw@beta`
- exact npm fallback:
  ```sh
  npm install -g openclaw@VERSION
  ```
- GitHub release link and npm version link
- concise validation note, without making CI the headline

For stable announcements, use the stable channel wording:

```sh
openclaw update --channel stable --yes
openclaw --version
```

Fresh installs still point to `https://openclaw.ai`.

## Style

- Discord Markdown, no tables.
- Keep it skimmable: short intro, bullets, commands, links.
- Lead with what users can feel or test, not proof plumbing.
- Mention validation only after install/update instructions.
- Be specific about where feedback is useful.
- Do not mention private local proof paths in public announcements.
- Do not overstate unverified platforms, channels, or provider behavior.

## Posting

When asked to post, use the configured Discord workflow from
`openclaw-discord` or the approved OpenClaw relay. Never print tokens.
For public channels, inspect the final body before sending.
