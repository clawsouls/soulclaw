# Publishing soulclaw from this fork

How the `soulclaw` npm package is published from this fork (first done 2026-08-12,
`2026.7.4`). Upstream's own release runs through
`.github/workflows/openclaw-npm-release.yml`, which we do not replicate; this is
the manual downstream procedure.

## Branch model

- `origin/develop` — tracks the upstream release line (npm `2026.7.x`). **Base
  every publish on this**, never on `origin/main` (stale, `2026.3.x`).
- `brand/soulclaw-identity` — our delta on top of develop (base identity line,
  `SOULCLAW_IDENTITY_LINE` env override).

## Requirements

- Node **>= 24.15 < 25** (engine gate; the build spawns the CLI which enforces
  it). If the system Node is older, prepend ClawSouls Desktop's bundled runtime:
  `PATH="$HOME/projects/clawsouls-desktop/src-tauri/bundled/node:$PATH"`.
- npm auth: `~/.npmrc` (account `tomleelive`).
- `CHANGELOG.md` must contain a `## <version>` section with a body of at least
  32 bytes — prepack fails otherwise (`scripts/package-changelog.mjs`).

## Procedure

1. Bump `version` in `package.json`, add the `## <version>` CHANGELOG section.
2. `pnpm build` — verify it passes and `dist/` contains the expected changes.
3. `npm publish` — prepack (`scripts/openclaw-prepack.ts`) rebuilds and stages
   the packaged changelog.
4. **Verify the published tarball installs in a clean directory** before
   telling anyone about the release:
   ```sh
   mkdir /tmp/sc-check && cd /tmp/sc-check && echo '{"name":"t","private":true}' > package.json
   npm install soulclaw@<version> --omit=dev --no-audit --no-fund
   node node_modules/soulclaw/dist/index.js --version
   ```

## The workspace:\* trap (why step 4 exists)

`package.json` declares `"@openclaw/ai": "workspace:*"`. Upstream's release
workflow rewrites this to the real version before publishing; a bare
`npm publish` ships it verbatim, and consumers' `npm install` then **fails with
exit 1 and no error message at all** (this burned `2026.7.3`, now deprecated).
Upstream also strips the `prepack`/`postpack`/`prepare` lifecycle scripts from
the shipped `package.json`.

If a publish ships broken, the salvage path that produced `2026.7.4`:

1. Download the broken tarball (`npm view soulclaw@<v> dist.tarball`), extract.
2. In `package/package.json`: bump the version, set `@openclaw/ai` to the exact
   version pinned in `package/npm-shrinkwrap.json`, delete the
   `prepack`/`postpack`/`prepare` scripts.
3. In `package/npm-shrinkwrap.json`: update the two root `version` fields.
4. Replace the old version string in the baked build metadata:
   `dist/build-info.json`, `dist/cli-startup-metadata.json`,
   `dist/control-ui/sw.js`, and the `control-ui` index asset.
5. Repack (`tar -czf soulclaw-<v>.tgz package`), rehearse an install from the
   local tarball, then `npm publish ./soulclaw-<v>.tgz` (tarball publish skips
   prepack) and `npm deprecate` the broken version.

A cleaner long-term fix is a small publish script that does the package.json
rewrite up front; until then, step 4 above is the safety net.

## After publishing

Update the consumers: `SOULCLAW_VERSION` in ClawSouls Desktop's
`scripts/prepare-bundle.mjs` and the pin table in its `README.md`, then rerun
`node scripts/prepare-bundle.mjs` and confirm the branding guard reports
`already patched` (identity fixed at source since `2026.7.4`).
