/**
 * Persona drift detection — compares assistant responses against
 * persona rules using Ollama LLM or keyword-based fallback.
 * @module persona/drift-detector
 */

import type { PersonaEngineConfig } from "./config.js";
import type { PersonaRules } from "./parser.js";
import { rulesToPromptBlock } from "./parser.js";

export interface DriftResult {
  score: number; // 0 = perfect match, 1 = full drift
  method: "ollama" | "keyword";
  details?: string;
  timestamp: number;
}

// ─── Ollama-based detection ────────────────────────────────────

async function detectWithOllama(
  response: string,
  rules: PersonaRules,
  config: PersonaEngineConfig,
): Promise<DriftResult> {
  const personaBlock = rulesToPromptBlock(rules);
  const prompt = `You are an evaluator. Given this persona definition:

${personaBlock}

Rate how well the following response DEVIATES from the persona on a scale of 0 to 1.
0 = perfectly matches the persona
1 = completely deviates from the persona

Response to evaluate:
"""
${response}
"""

Reply with ONLY a decimal number between 0 and 1. Nothing else.`;

  const res = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 10 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status}`);
  }

  const data = (await res.json()) as { response: string };
  const scoreMatch = data.response.trim().match(/([0-9]*\.?[0-9]+)/);
  const score = scoreMatch ? Math.min(1, Math.max(0, parseFloat(scoreMatch[1]))) : 0.5;

  return {
    score,
    method: "ollama",
    details: data.response.trim(),
    timestamp: Date.now(),
  };
}

// ─── Keyword-based fallback ────────────────────────────────────

function detectWithKeywords(response: string, rules: PersonaRules): DriftResult {
  const responseLower = response.toLowerCase();
  const allKeywords = [...rules.tone, ...rules.style, ...rules.principles].map((k) =>
    k.toLowerCase(),
  );

  if (allKeywords.length === 0) {
    return { score: 0, method: "keyword", details: "No keywords to check", timestamp: Date.now() };
  }

  // Check boundary violations (presence = bad)
  const boundaryViolations = rules.boundaries.filter((b) =>
    responseLower.includes(b.toLowerCase()),
  ).length;

  // Check keyword alignment (presence = good)
  const keywordHits = allKeywords.filter((k) => responseLower.includes(k)).length;
  const alignmentRatio = keywordHits / allKeywords.length;

  // Simple heuristic: low alignment + boundary violations = high drift
  const boundaryPenalty =
    rules.boundaries.length > 0 ? (boundaryViolations / rules.boundaries.length) * 0.5 : 0;
  const score = Math.min(1, Math.max(0, (1 - alignmentRatio) * 0.5 + boundaryPenalty));

  return {
    score,
    method: "keyword",
    details: `keywords=${keywordHits}/${allKeywords.length}, violations=${boundaryViolations}`,
    timestamp: Date.now(),
  };
}

// ─── Public API ────────────────────────────────────────────────

export async function detectDrift(
  response: string,
  rules: PersonaRules,
  config: PersonaEngineConfig,
): Promise<DriftResult> {
  if (config.useOllama) {
    try {
      return await detectWithOllama(response, rules, config);
    } catch {
      // Ollama unavailable — fall back to keyword
    }
  }
  return detectWithKeywords(response, rules);
}
