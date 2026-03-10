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

type SoulDetail = {
  fullName: string;
  displayName: string;
  description: string;
  files: Record<string, { content?: string }>;
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

async function fetchSoulFiles(fullName: string): Promise<SoulDetail | null> {
  try {
    const [owner, name] = fullName.split("/");
    const url = `${CLAWSOULS_API}/souls/${owner}/${name}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "SoulClaw-Onboard/1.0" },
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as SoulDetail;
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

  // Fetch full soul details
  const detail = await fetchSoulFiles(chosen);
  if (!detail || !detail.files) {
    await prompter.note(
      `Could not fetch soul details for ${chosen}. Using default persona.`,
      "Soul Selection",
    );
    return { selected: false };
  }

  // Write SOUL.md
  const soulContent = detail.files["SOUL.md"]?.content;
  if (soulContent) {
    const soulPath = path.join(workspaceDir, "SOUL.md");
    await fs.writeFile(soulPath, soulContent, "utf-8");
  }

  // Write IDENTITY.md if available
  const identityContent = detail.files["IDENTITY.md"]?.content;
  if (identityContent) {
    const identityPath = path.join(workspaceDir, "IDENTITY.md");
    await fs.writeFile(identityPath, identityContent, "utf-8");
  }

  await prompter.note(
    `Installed ${detail.displayName} as your AI persona.\nBrowse more at https://clawsouls.ai/souls`,
    "Soul Selection",
  );

  return { selected: true, soulName: chosen };
}
