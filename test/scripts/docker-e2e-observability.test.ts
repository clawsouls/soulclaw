// Docker E2E Observability tests cover docker e2e observability script behavior.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker E2E observability", () => {
  it.each(["scripts/e2e/mcp-channels-docker.sh", "scripts/e2e/cron-mcp-cleanup-docker.sh"])(
    "prints successful MCP client proof logs from %s",
    (scriptPath) => {
      const script = readFileSync(scriptPath, "utf8");
      const successTail = script.slice(script.lastIndexOf('if [ "$status" -ne 0 ]; then'));

      expect(successTail).toContain('docker_e2e_print_log "$CLIENT_LOG"');
      expect(successTail.indexOf('docker_e2e_print_log "$CLIENT_LOG"')).toBeLessThan(
        successTail.indexOf('echo "OK"'),
      );
    },
  );
});
