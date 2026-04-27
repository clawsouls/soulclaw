import pluginSdkEntryList from "../../scripts/lib/plugin-sdk-entrypoints.json" with { type: "json" };

export const pluginSdkEntrypoints = [...pluginSdkEntryList];

export const pluginSdkSubpaths = pluginSdkEntrypoints.filter((entry) => entry !== "index");

export const reservedBundledPluginSdkEntrypoints = [
  "bluebubbles",
  "bluebubbles-policy",
  "browser-cdp",
  "browser-config-runtime",
  "browser-config-support",
  "browser-control-auth",
  "browser-node-runtime",
  "browser-profiles",
  "browser-security-runtime",
  "browser-setup-tools",
  "browser-support",
  "diagnostics-otel",
  "diagnostics-prometheus",
  "diffs",
  "feishu",
  "feishu-conversation",
  "feishu-setup",
  "github-copilot-login",
  "github-copilot-token",
  "googlechat",
  "googlechat-runtime-shared",
  "irc",
  "irc-surface",
  "line",
  "line-core",
  "line-runtime",
  "line-surface",
  "llm-task",
  "matrix",
  "matrix-helper",
  "matrix-runtime-heavy",
  "matrix-runtime-shared",
  "matrix-runtime-surface",
  "matrix-surface",
  "matrix-thread-bindings",
  "mattermost",
  "mattermost-policy",
  "memory-core",
  "memory-lancedb",
  "msteams",
  "nextcloud-talk",
  "nostr",
  "thread-ownership",
  "tlon",
  "twitch",
  "voice-call",
  "zalo",
  "zalo-setup",
  "zalouser",
] as const;

export const supportedBundledFacadeSdkEntrypoints = [
  "lmstudio",
  "lmstudio-runtime",
  "memory-core-engine-runtime",
  "qa-runner-runtime",
  "tts-runtime",
] as const;

/** Map every SDK entrypoint name to its source file path inside the repo. */
export function buildPluginSdkEntrySources(entries: readonly string[] = pluginSdkEntrypoints) {
  return Object.fromEntries(entries.map((entry) => [entry, `src/plugin-sdk/${entry}.ts`]));
}

/** List the public package specifiers that should resolve to plugin SDK entrypoints. */
export function buildPluginSdkSpecifiers() {
  return pluginSdkEntrypoints.map((entry) =>
    entry === "index" ? "openclaw/plugin-sdk" : `openclaw/plugin-sdk/${entry}`,
  );
}

/** Build the package.json exports map for all plugin SDK subpaths. */
export function buildPluginSdkPackageExports() {
  return Object.fromEntries(
    pluginSdkEntrypoints.map((entry) => [
      entry === "index" ? "./plugin-sdk" : `./plugin-sdk/${entry}`,
      {
        types: `./dist/plugin-sdk/${entry}.d.ts`,
        default: `./dist/plugin-sdk/${entry}.js`,
      },
    ]),
  );
}

/** List the dist artifacts expected for every generated plugin SDK entrypoint. */
export function listPluginSdkDistArtifacts() {
  return pluginSdkEntrypoints.flatMap((entry) => [
    `dist/plugin-sdk/${entry}.js`,
    `dist/plugin-sdk/${entry}.d.ts`,
  ]);
}
