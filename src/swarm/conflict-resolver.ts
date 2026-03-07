/**
 * Swarm conflict resolver — LLM-assisted git merge conflict resolution
 */

import { readFileSync, writeFileSync } from "fs";
import { type SwarmConfig, resolveSwarmConfig } from "./config.js";

export interface ConflictResolution {
  file: string;
  resolved: boolean;
  content: string;
  method: "llm" | "fallback";
  reason?: string;
}

/**
 * Resolve merge conflicts in a file using LLM (Ollama) or fallback strategy
 */
export async function resolveConflict(
  filePath: string,
  config?: Partial<SwarmConfig>,
): Promise<ConflictResolution> {
  const cfg = resolveSwarmConfig(config);
  const content = readFileSync(filePath, "utf-8");

  // Check if file has conflict markers
  if (!hasConflictMarkers(content)) {
    return { file: filePath, resolved: true, content, method: "fallback", reason: "no conflicts" };
  }

  // Try LLM resolution
  try {
    const resolved = await llmResolve(content, cfg);
    writeFileSync(filePath, resolved.content);
    return {
      file: filePath,
      resolved: true,
      content: resolved.content,
      method: "llm",
      reason: resolved.reason,
    };
  } catch {
    // Fallback: take "ours" side
    const fallbackContent = fallbackResolve(content);
    writeFileSync(filePath, fallbackContent);
    return {
      file: filePath,
      resolved: true,
      content: fallbackContent,
      method: "fallback",
      reason: "LLM unavailable, kept ours",
    };
  }
}

/**
 * Check if content has git conflict markers
 */
export function hasConflictMarkers(content: string): boolean {
  return content.includes("<<<<<<<") && content.includes(">>>>>>>");
}

/**
 * Resolve conflicts using Ollama LLM
 */
async function llmResolve(
  content: string,
  config: SwarmConfig,
): Promise<{ content: string; reason: string }> {
  const prompt = `You are merging two versions of a memory/documentation file. 
The file contains git conflict markers. Resolve the conflicts by intelligently merging both sides.
Rules:
- Preserve all unique information from both sides
- Remove duplicate entries
- Keep the most recent/complete version of conflicting entries  
- Remove all conflict markers (<<<<<<, ======, >>>>>>)
- Output ONLY the resolved file content, no explanations

File with conflicts:
${content}`;

  const response = await fetch(`${config.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.llmModel,
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const result = (await response.json()) as { response: string };
  return { content: result.response.trim(), reason: `resolved by ${config.llmModel}` };
}

/**
 * Fallback: keep "ours" side of conflicts
 */
function fallbackResolve(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inConflict = false;
  let keepOurs = true;

  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      inConflict = true;
      keepOurs = true;
      continue;
    }
    if (line.startsWith("=======")) {
      keepOurs = false;
      continue;
    }
    if (line.startsWith(">>>>>>>")) {
      inConflict = false;
      continue;
    }

    if (!inConflict || keepOurs) {
      result.push(line);
    }
  }

  return result.join("\n");
}
