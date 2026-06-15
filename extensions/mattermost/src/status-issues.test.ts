// Mattermost tests cover status issues plugin behavior.
import { expectOpenDmPolicyConfigIssue } from "openclaw/plugin-sdk/channel-test-helpers";
import { describe, expect, it } from "vitest";
import { collectMattermostStatusIssues } from "./status-issues.js";

describe("collectMattermostStatusIssues", () => {
  it("warns when dmPolicy is open without a wildcard allowlist", () => {
    expectOpenDmPolicyConfigIssue({
      collectIssues: collectMattermostStatusIssues,
      account: {
        accountId: "default",
        enabled: true,
        configured: true,
        dmPolicy: "open",
      },
    });
  });

  it("allows open dmPolicy when allowFrom includes the wildcard", () => {
    expect(
      collectMattermostStatusIssues([
        {
          accountId: "default",
          enabled: true,
          configured: true,
          dmPolicy: "open",
          allowFrom: ["*"],
        },
      ]),
    ).toEqual([]);
  });
});
