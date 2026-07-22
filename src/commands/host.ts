import { exec } from "node:child_process";

const HOSTING_URL = "https://clawsouls.ai/hosting";

export async function hostCommand() {
  console.log(`\n☁️  Opening ClawSouls Hosting → ${HOSTING_URL}\n`);
  console.log("  Deploy your AI agent to the cloud — 24/7, no server setup needed.");
  console.log("  BYOK (Bring Your Own Key) — use your own LLM API key.\n");

  // Open browser cross-platform
  const cmd =
    process.platform === "darwin"
      ? `open "${HOSTING_URL}"`
      : process.platform === "win32"
        ? `start "${HOSTING_URL}"`
        : `xdg-open "${HOSTING_URL}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`  Open manually: ${HOSTING_URL}\n`);
    }
  });
}
