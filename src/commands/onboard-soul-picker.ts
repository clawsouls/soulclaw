import fs from "node:fs/promises";
import path from "node:path";
import type { WizardPrompter } from "../wizard/prompts.js";

const CLAWSOULS_API = "https://clawsouls.ai/api/v1";

type SoulSummary = {
  fullName: string;
  displayName: string;
  description: string;
  downloads: number;
  category: string;
};

type SoulBundle = {
  manifest: { displayName?: string };
  files: Record<string, string>;
  owner: string;
  name: string;
  version: string;
};

async function fetchPopularSouls(limit = 10): Promise<SoulSummary[]> {
  try {
    const url = `${CLAWSOULS_API}/souls?limit=${limit}&sort=downloads`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "SoulClaw-Onboard/1.0" },
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { souls?: SoulSummary[] };
    return data.souls ?? [];
  } catch {
    return [];
  }
}

async function fetchSoulBundle(fullName: string): Promise<SoulBundle | null> {
  try {
    const [owner, name] = fullName.split("/");
    const url = `${CLAWSOULS_API}/bundle/${owner}/${name}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "SoulClaw-Onboard/1.0" },
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as SoulBundle;
  } catch {
    return null;
  }
}

/**
 * Prompt user to optionally pick a soul from ClawSouls during onboarding.
 * Writes SOUL.md (and optionally IDENTITY.md) to the workspace.
 */
export async function promptSoulSelection(params: {
  workspaceDir: string;
  prompter: WizardPrompter;
}): Promise<{ selected: boolean; soulName?: string }> {
  const { workspaceDir, prompter } = params;

  const wantSoul = await prompter.confirm({
    message: "Choose an AI persona from ClawSouls? (89+ community souls available)",
    initialValue: true,
  });

  if (!wantSoul) {
    return { selected: false };
  }

  const souls = await fetchPopularSouls(15);
  if (souls.length === 0) {
    await prompter.note(
      "Could not reach ClawSouls. You can install a soul later with: npx clawsouls install owner/name",
      "Soul Selection",
    );
    return { selected: false };
  }

  // Group by broad category for better UX
  const options = souls.map((soul) => ({
    value: soul.fullName,
    label: soul.displayName,
    hint: `${soul.description} (↓${soul.downloads})`,
  }));

  options.push({
    value: "__skip__",
    label: "Skip — use default persona",
    hint: "You can install a soul later",
  });

  const chosen = await prompter.select({
    message: "Pick a soul for your AI",
    options,
  });

  if (chosen === "__skip__") {
    return { selected: false };
  }

  // Fetch full soul bundle (includes file contents)
  const bundle = await fetchSoulBundle(chosen);
  if (!bundle || !bundle.files || Object.keys(bundle.files).length === 0) {
    await prompter.note(
      `Could not fetch soul files for ${chosen}. Using default persona.`,
      "Soul Selection",
    );
    return { selected: false };
  }

  // Known workspace files that a soul can override
  const SOUL_FILES = [
    "SOUL.md",
    "IDENTITY.md",
    "AGENTS.md",
    "STYLE.md",
    "HEARTBEAT.md",
    "TOOLS.md",
    "USER.md",
    "BOOTSTRAP.md",
  ];

  // Remove existing soul files before writing new ones
  for (const filename of SOUL_FILES) {
    const filePath = path.join(workspaceDir, filename);
    try {
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist — fine
    }
  }

  // Write all files from the bundle
  const writtenFiles: string[] = [];
  for (const [filename, content] of Object.entries(bundle.files)) {
    if (typeof content === "string" && content.length > 0) {
      const filePath = path.join(workspaceDir, filename);
      await fs.writeFile(filePath, content, "utf-8");
      writtenFiles.push(filename);
    }
  }

  const displayName = bundle.manifest?.displayName ?? chosen;
  await prompter.note(
    `Installed ${displayName} (${writtenFiles.join(", ")}).\nBrowse more at https://clawsouls.ai/souls`,
    "Soul Selection",
  );

  return { selected: true, soulName: chosen };
}
