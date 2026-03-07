/**
 * Soul Spec v0.3 parser — extracts structured persona rules from
 * soul.json (JSON) or SOUL.md (Markdown).
 * @module persona/parser
 */

export interface PersonaRules {
  name: string;
  tone: string[];
  style: string[];
  principles: string[];
  boundaries: string[];
  communicationRules: string[];
  raw: Record<string, unknown>;
}

function emptyRules(): PersonaRules {
  return {
    name: "",
    tone: [],
    style: [],
    principles: [],
    boundaries: [],
    communicationRules: [],
    raw: {},
  };
}

// ─── JSON parser ───────────────────────────────────────────────

function parseJson(content: string): PersonaRules {
  const obj = JSON.parse(content) as Record<string, unknown>;
  const rules = emptyRules();
  rules.raw = obj;
  rules.name = typeof obj["name"] === "string" ? obj["name"] : "";
  rules.tone = toStringArray(obj["tone"]);
  rules.style = toStringArray(obj["style"]);
  rules.principles = toStringArray(obj["principles"]);
  rules.boundaries = toStringArray(obj["boundaries"]);
  rules.communicationRules = toStringArray(
    obj["communicationRules"] ?? obj["communication_rules"] ?? obj["rules"],
  );
  return rules;
}

// ─── Markdown parser ───────────────────────────────────────────

const SECTION_MAP: Record<string, keyof Omit<PersonaRules, "raw" | "name">> = {
  tone: "tone",
  voice: "tone",
  style: "style",
  principles: "principles",
  values: "principles",
  boundaries: "boundaries",
  limits: "boundaries",
  "communication rules": "communicationRules",
  communication: "communicationRules",
  rules: "communicationRules",
};

function parseMarkdown(content: string): PersonaRules {
  const rules = emptyRules();
  rules.raw = { _markdown: content };

  const lines = content.split("\n");

  // Extract name from first H1
  const h1 = lines.find((l) => /^#\s+/.test(l));
  if (h1) {
    rules.name = h1.replace(/^#\s+/, "").trim();
  }

  let currentField: keyof Omit<PersonaRules, "raw" | "name"> | null = null;

  for (const line of lines) {
    // Detect section headers (## or ###)
    const headerMatch = line.match(/^#{2,3}\s+(.+)/);
    if (headerMatch) {
      const heading = headerMatch[1].trim().toLowerCase();
      currentField = SECTION_MAP[heading] ?? null;
      continue;
    }

    // Collect bullet points under current section
    if (currentField) {
      const bullet = line.match(/^\s*[-*]\s+(.+)/);
      if (bullet) {
        rules[currentField].push(bullet[1].trim());
      }
    }
  }

  return rules;
}

// ─── Helpers ───────────────────────────────────────────────────

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map(String);
  }
  if (typeof val === "string") {
    return [val];
  }
  return [];
}

// ─── Public API ────────────────────────────────────────────────

export function parseSoulSpec(content: string, format: "json" | "markdown"): PersonaRules {
  return format === "json" ? parseJson(content) : parseMarkdown(content);
}

/**
 * Produce a compact text summary of persona rules for prompt injection.
 */
export function rulesToPromptBlock(rules: PersonaRules): string {
  const sections: string[] = [];
  if (rules.name) {
    sections.push(`Persona: ${rules.name}`);
  }
  if (rules.tone.length) {
    sections.push(`Tone: ${rules.tone.join(", ")}`);
  }
  if (rules.style.length) {
    sections.push(`Style: ${rules.style.join(", ")}`);
  }
  if (rules.principles.length) {
    sections.push(`Principles:\n${rules.principles.map((p) => `- ${p}`).join("\n")}`);
  }
  if (rules.boundaries.length) {
    sections.push(`Boundaries:\n${rules.boundaries.map((b) => `- ${b}`).join("\n")}`);
  }
  if (rules.communicationRules.length) {
    sections.push(
      `Communication Rules:\n${rules.communicationRules.map((r) => `- ${r}`).join("\n")}`,
    );
  }
  return sections.join("\n\n");
}
