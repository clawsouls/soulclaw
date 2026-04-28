#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "openclaw-kitchen-sink-plugin-e2e" OPENCLAW_KITCHEN_SINK_PLUGIN_E2E_IMAGE)"

docker_e2e_build_or_reuse "$IMAGE_NAME" kitchen-sink-plugin
OPENCLAW_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 kitchen-sink-plugin empty)"

KITCHEN_SINK_SPEC="${OPENCLAW_KITCHEN_SINK_PLUGIN_SPEC:-npm:@openclaw/kitchen-sink@0.1.0}"
KITCHEN_SINK_RESOLVED_SPEC="${KITCHEN_SINK_SPEC#npm:}"
KITCHEN_SINK_ID="${OPENCLAW_KITCHEN_SINK_PLUGIN_ID:-openclaw-kitchen-sink}"
MAX_MEMORY_MIB="${OPENCLAW_KITCHEN_SINK_MAX_MEMORY_MIB:-2048}"
MAX_CPU_PERCENT="${OPENCLAW_KITCHEN_SINK_MAX_CPU_PERCENT:-1200}"
CONTAINER_NAME="openclaw-kitchen-sink-plugin-e2e-$$"
RUN_LOG="$(mktemp "${TMPDIR:-/tmp}/openclaw-kitchen-sink-plugin.XXXXXX")"
STATS_LOG="$(mktemp "${TMPDIR:-/tmp}/openclaw-kitchen-sink-plugin-stats.XXXXXX")"
SCRIPT_FILE="$(mktemp "${TMPDIR:-/tmp}/openclaw-kitchen-sink-plugin-script.XXXXXX")"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$SCRIPT_FILE"
}
trap cleanup EXIT

cat > "$SCRIPT_FILE" <<'EOF'
set -euo pipefail

if [ -f dist/index.mjs ]; then
  OPENCLAW_ENTRY="dist/index.mjs"
elif [ -f dist/index.js ]; then
  OPENCLAW_ENTRY="dist/index.js"
else
  echo "Missing dist/index.(m)js (build output):"
  ls -la dist || true
  exit 1
fi
export OPENCLAW_ENTRY

eval "$(printf "%s" "${OPENCLAW_TEST_STATE_SCRIPT_B64:?missing OPENCLAW_TEST_STATE_SCRIPT_B64}" | base64 -d)"

run_logged() {
  local label="$1"
  shift
  local log_file="/tmp/openclaw-kitchen-sink-${label}.log"
  if ! "$@" >"$log_file" 2>&1; then
    cat "$log_file"
    exit 1
  fi
  cat "$log_file"
}

scan_logs_for_unexpected_errors() {
  node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const roots = ["/tmp", path.join(process.env.HOME, ".openclaw")];
const files = [];
const visit = (entry) => {
  if (!fs.existsSync(entry)) {
    return;
  }
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entry)) {
      visit(path.join(entry, child));
    }
    return;
  }
  if (/\.(?:log|jsonl)$/u.test(entry) || /openclaw-kitchen-sink-/u.test(path.basename(entry))) {
    files.push(entry);
  }
};
for (const root of roots) {
  visit(root);
}

const deny = [
  /\buncaught exception\b/iu,
  /\bunhandled rejection\b/iu,
  /\bfatal\b/iu,
  /\bpanic\b/iu,
  /\blevel["']?\s*:\s*["']error["']/iu,
  /\[(?:error|ERROR)\]/u,
];
const allow = [
  /0 errors?/iu,
  /expected no diagnostics errors?/iu,
  /diagnostics errors?:\s*$/iu,
];
const findings = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (allow.some((pattern) => pattern.test(line))) {
      return;
    }
    if (deny.some((pattern) => pattern.test(line))) {
      findings.push(`${file}:${index + 1}: ${line}`);
    }
  });
}
if (findings.length > 0) {
  throw new Error(`unexpected error-like log lines:\n${findings.join("\n")}`);
}
console.log(`log scan passed (${files.length} file(s))`);
NODE
}

echo "Testing npm kitchen-sink plugin install from ${KITCHEN_SINK_SPEC}..."
run_logged install-kitchen-sink node "$OPENCLAW_ENTRY" plugins install "$KITCHEN_SINK_SPEC"
run_logged enable-kitchen-sink node "$OPENCLAW_ENTRY" plugins enable "$KITCHEN_SINK_ID"
node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const configPath = path.join(process.env.HOME, ".openclaw", "openclaw.json");
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
config.plugins = config.plugins || {};
config.plugins.entries = config.plugins.entries || {};
config.plugins.entries["openclaw-kitchen-sink"] = {
  ...(config.plugins.entries["openclaw-kitchen-sink"] || {}),
  hooks: {
    ...(config.plugins.entries["openclaw-kitchen-sink"]?.hooks || {}),
    allowConversationAccess: true,
  },
};
config.channels = {
  ...(config.channels || {}),
  "kitchen-sink-channel": { enabled: true, token: "kitchen-sink-ci" },
};
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE
node "$OPENCLAW_ENTRY" plugins list --json > /tmp/kitchen-sink-plugins.json
node "$OPENCLAW_ENTRY" plugins inspect "$KITCHEN_SINK_ID" --json > /tmp/kitchen-sink-inspect.json
node "$OPENCLAW_ENTRY" plugins inspect --all --json > /tmp/kitchen-sink-inspect-all.json

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const pluginId = process.env.KITCHEN_SINK_ID;
const spec = process.env.KITCHEN_SINK_SPEC;
const resolvedSpec = process.env.KITCHEN_SINK_RESOLVED_SPEC;
const list = JSON.parse(fs.readFileSync("/tmp/kitchen-sink-plugins.json", "utf8"));
const inspect = JSON.parse(fs.readFileSync("/tmp/kitchen-sink-inspect.json", "utf8"));
const allInspect = JSON.parse(fs.readFileSync("/tmp/kitchen-sink-inspect-all.json", "utf8"));
const plugin = (list.plugins || []).find((entry) => entry.id === pluginId);
if (!plugin) throw new Error(`kitchen-sink plugin not found after install: ${pluginId}`);
if (plugin.status !== "loaded") {
  throw new Error(`unexpected kitchen-sink status after enable: ${plugin.status}`);
}
if (inspect.plugin?.id !== pluginId) {
  throw new Error(`unexpected inspected kitchen-sink plugin id: ${inspect.plugin?.id}`);
}
if (inspect.plugin?.enabled !== true || inspect.plugin?.status !== "loaded") {
  throw new Error(
    `expected enabled loaded kitchen-sink plugin, got enabled=${inspect.plugin?.enabled} status=${inspect.plugin?.status}`,
  );
}

const expectIncludes = (listValue, expected, label) => {
  if (!Array.isArray(listValue) || !listValue.includes(expected)) {
    throw new Error(`${label} missing ${expected}: ${JSON.stringify(listValue)}`);
  }
};
const toolNames = Array.isArray(inspect.tools)
  ? inspect.tools.flatMap((entry) => (Array.isArray(entry?.names) ? entry.names : []))
  : [];
expectIncludes(inspect.plugin?.channelIds, "kitchen-sink-channel", "channels");
expectIncludes(inspect.plugin?.providerIds, "kitchen-sink-provider", "providers");
expectIncludes(inspect.plugin?.speechProviderIds, "kitchen-sink-speech-provider", "speech providers");
expectIncludes(
  inspect.plugin?.realtimeTranscriptionProviderIds,
  "kitchen-sink-realtime-transcription-provider",
  "realtime transcription providers",
);
expectIncludes(
  inspect.plugin?.realtimeVoiceProviderIds,
  "kitchen-sink-realtime-voice-provider",
  "realtime voice providers",
);
expectIncludes(
  inspect.plugin?.mediaUnderstandingProviderIds,
  "kitchen-sink-media-understanding-provider",
  "media understanding providers",
);
expectIncludes(
  inspect.plugin?.imageGenerationProviderIds,
  "kitchen-sink-image-generation-provider",
  "image generation providers",
);
expectIncludes(
  inspect.plugin?.videoGenerationProviderIds,
  "kitchen-sink-video-generation-provider",
  "video generation providers",
);
expectIncludes(
  inspect.plugin?.musicGenerationProviderIds,
  "kitchen-sink-music-generation-provider",
  "music generation providers",
);
expectIncludes(inspect.plugin?.webFetchProviderIds, "kitchen-sink-web-fetch-provider", "web fetch providers");
expectIncludes(inspect.plugin?.webSearchProviderIds, "kitchen-sink-web-search-provider", "web search providers");
expectIncludes(inspect.plugin?.migrationProviderIds, "kitchen-sink-migration-provider", "migration providers");
expectIncludes(inspect.plugin?.agentHarnessIds, "kitchen-sink-agent-harness", "agent harnesses");
expectIncludes(inspect.services, "kitchen-sink-service", "services");
expectIncludes(inspect.commands, "kitchen-sink-command", "commands");
expectIncludes(toolNames, "kitchen-sink-tool", "tools");
if ((inspect.plugin?.hookCount || 0) < 30 || !Array.isArray(inspect.typedHooks) || inspect.typedHooks.length < 30) {
  throw new Error(
    `expected kitchen-sink typed hooks to load, got hookCount=${inspect.plugin?.hookCount} typedHooks=${inspect.typedHooks?.length}`,
  );
}

const diagnostics = [
  ...(list.diagnostics || []),
  ...(inspect.diagnostics || []),
  ...(allInspect.diagnostics || []),
];
const expectedErrorMessages = new Set([
  "only bundled plugins can register agent tool result middleware",
  "cli registration missing explicit commands metadata",
  "only bundled plugins can register Codex app-server extension factories",
  "http route registration missing or invalid auth: /kitchen-sink/http-route",
  "plugin must own memory slot or declare contracts.memoryEmbeddingProviders for adapter: kitchen-sink-memory-embedding-provider",
]);
const errorMessages = new Set(
  diagnostics
    .filter((diag) => diag?.level === "error")
    .map((diag) => String(diag.message || "")),
);
for (const message of errorMessages) {
  if (!expectedErrorMessages.has(message)) {
    throw new Error(`unexpected kitchen-sink diagnostic error: ${message}`);
  }
}
for (const message of expectedErrorMessages) {
  if (!errorMessages.has(message)) {
    throw new Error(`missing expected kitchen-sink diagnostic error: ${message}`);
  }
}

const indexPath = path.join(process.env.HOME, ".openclaw", "plugins", "installs.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const record = (index.installRecords ?? index.records ?? {})[pluginId];
if (!record) throw new Error(`missing kitchen-sink install record for ${pluginId}`);
if (record.source !== "npm") {
  throw new Error(`expected kitchen-sink install source=npm, got ${record.source}`);
}
if (record.spec !== resolvedSpec) {
  throw new Error(`expected kitchen-sink npm spec ${resolvedSpec}, got ${record.spec} from ${spec}`);
}
if (typeof record.installPath !== "string" || record.installPath.length === 0) {
  throw new Error("missing kitchen-sink install path");
}
if (!fs.existsSync(record.installPath.replace(/^~(?=$|\/)/u, process.env.HOME))) {
  throw new Error(`kitchen-sink install path missing: ${record.installPath}`);
}
console.log("ok");
NODE

run_logged uninstall-kitchen-sink node "$OPENCLAW_ENTRY" plugins uninstall "$KITCHEN_SINK_ID" --force
node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const configPath = path.join(process.env.HOME, ".openclaw", "openclaw.json");
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  delete config.channels?.["kitchen-sink-channel"];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
NODE
node "$OPENCLAW_ENTRY" plugins list --json > /tmp/kitchen-sink-uninstalled.json

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const pluginId = process.env.KITCHEN_SINK_ID;
const list = JSON.parse(fs.readFileSync("/tmp/kitchen-sink-uninstalled.json", "utf8"));
if ((list.plugins || []).some((entry) => entry.id === pluginId)) {
  throw new Error(`kitchen-sink plugin still listed after uninstall: ${pluginId}`);
}

const indexPath = path.join(process.env.HOME, ".openclaw", "plugins", "installs.json");
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : {};
const records = index.installRecords ?? index.records ?? {};
if (records[pluginId]) {
  throw new Error(`kitchen-sink install record still present after uninstall: ${pluginId}`);
}

const configPath = path.join(process.env.HOME, ".openclaw", "openclaw.json");
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
if (config.plugins?.entries?.[pluginId]) {
  throw new Error(`kitchen-sink config entry still present after uninstall: ${pluginId}`);
}
if ((config.plugins?.allow || []).includes(pluginId)) {
  throw new Error(`kitchen-sink allowlist still contains ${pluginId}`);
}
if (config.channels?.["kitchen-sink-channel"]) {
  throw new Error("kitchen-sink channel config still present after uninstall");
}
console.log("ok");
NODE

scan_logs_for_unexpected_errors
echo "kitchen-sink npm plugin Docker E2E passed"
EOF

DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e "OPENCLAW_TEST_STATE_SCRIPT_B64=$OPENCLAW_TEST_STATE_SCRIPT_B64"
  -e "KITCHEN_SINK_SPEC=$KITCHEN_SINK_SPEC"
  -e "KITCHEN_SINK_RESOLVED_SPEC=$KITCHEN_SINK_RESOLVED_SPEC"
  -e "KITCHEN_SINK_ID=$KITCHEN_SINK_ID"
)

echo "Running kitchen-sink npm plugin Docker E2E..."
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run --name "$CONTAINER_NAME" "${DOCKER_ENV_ARGS[@]}" -i "$IMAGE_NAME" bash -s \
  >"$RUN_LOG" 2>&1 < "$SCRIPT_FILE" &
docker_pid="$!"

while kill -0 "$docker_pid" 2>/dev/null; do
  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker stats --no-stream --format '{{json .}}' "$CONTAINER_NAME" >>"$STATS_LOG" 2>/dev/null || true
  fi
  sleep 2
done

set +e
wait "$docker_pid"
run_status="$?"
set -e

cat "$RUN_LOG"

node - <<'NODE' "$STATS_LOG" "$MAX_MEMORY_MIB" "$MAX_CPU_PERCENT"
const fs = require("node:fs");

const [statsFile, maxMemoryRaw, maxCpuRaw] = process.argv.slice(2);
const maxMemoryMiB = Number(maxMemoryRaw);
const maxCpuPercent = Number(maxCpuRaw);
const parseMemoryMiB = (raw) => {
  const value = String(raw || "").split("/")[0]?.trim() || "";
  const match = /^([0-9.]+)\s*([KMGT]?i?B)$/iu.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "kb" || unit === "kib") return amount / 1024;
  if (unit === "mb" || unit === "mib") return amount;
  if (unit === "gb" || unit === "gib") return amount * 1024;
  if (unit === "tb" || unit === "tib") return amount * 1024 * 1024;
  return 0;
};
const lines = fs.existsSync(statsFile)
  ? fs.readFileSync(statsFile, "utf8").split(/\r?\n/u).filter(Boolean)
  : [];
let maxObservedMemoryMiB = 0;
let maxObservedCpuPercent = 0;
for (const line of lines) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    continue;
  }
  maxObservedMemoryMiB = Math.max(maxObservedMemoryMiB, parseMemoryMiB(parsed.MemUsage));
  maxObservedCpuPercent = Math.max(
    maxObservedCpuPercent,
    Number(String(parsed.CPUPerc || "0").replace(/%$/u, "")) || 0,
  );
}
console.log(
  `kitchen-sink resource peak: memory=${maxObservedMemoryMiB.toFixed(1)}MiB cpu=${maxObservedCpuPercent.toFixed(1)}% samples=${lines.length}`,
);
if (lines.length === 0) {
  throw new Error("no docker stats samples captured for kitchen-sink plugin lane");
}
if (maxObservedMemoryMiB > maxMemoryMiB) {
  throw new Error(
    `kitchen-sink memory peak ${maxObservedMemoryMiB.toFixed(1)}MiB exceeded ${maxMemoryMiB}MiB`,
  );
}
if (maxObservedCpuPercent > maxCpuPercent) {
  throw new Error(
    `kitchen-sink CPU peak ${maxObservedCpuPercent.toFixed(1)}% exceeded ${maxCpuPercent}%`,
  );
}
NODE

rm -f "$RUN_LOG" "$STATS_LOG"
exit "$run_status"
