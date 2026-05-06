// src/lib/reports/ai-prompt.ts
//
// Pure prompt assembly for the `aiAnalysis` widget. Splits the system
// prompt (role + tone + length) from the user prompt (data summaries)
// so the Azure call can keep the system message identical across
// regenerations and only the user payload varies. Each scope's
// per-AI summary comes from the scope registry's `serializeForAI`,
// which is already token-capped.
//
// Unregistered scopes (e.g. `tax`/`estate` in v1) fall through the
// try/catch and surface as `(unavailable)` rather than crashing the
// route — the AI handles missing sections gracefully.

import { getScope, type ScopeKey } from "./scope-registry";
import type { AiScope, AiTone, AiLength } from "./types";

const TONE_INSTRUCTIONS: Record<AiTone, string> = {
  concise: "Be concise and direct. Lead with the main point.",
  detailed: "Be detailed. Include specific numbers and short explanations.",
  plain: "Use plain English. Avoid jargon. Address the household directly.",
};

const LENGTH_HINTS: Record<AiLength, string> = {
  short: "1-2 short paragraphs.",
  medium: "3-4 short paragraphs.",
  long: "5-6 short paragraphs.",
};

export function buildAiPrompt({
  scopes,
  tone,
  length,
  scopeData,
  householdName,
}: {
  scopes: AiScope[];
  tone: AiTone;
  length: AiLength;
  scopeData: Record<string, unknown>;
  householdName: string;
}): { system: string; user: string } {
  const system = [
    "You are a financial-planning assistant generating advisor-facing commentary for an annual review or retirement roadmap report.",
    "Output: clean Markdown only. No preamble like 'Here is your analysis'.",
    "Do not invent numbers. If a number is not in the data, do not write a number — describe direction (rising/falling/steady) instead.",
    "Do not give individualized advice. Frame observations and risks, not recommendations.",
    "Keep paragraphs short (2-4 sentences each).",
    TONE_INSTRUCTIONS[tone],
    LENGTH_HINTS[length],
  ].join(" ");

  const summaries = scopes
    .map((s) => {
      try {
        return `[${s}] ${getScope(s as ScopeKey).serializeForAI(scopeData[s])}`;
      } catch {
        return `[${s}] (unavailable)`;
      }
    })
    .join("\n");

  const user = [
    `Household: ${householdName}.`,
    "",
    "Data summaries:",
    summaries,
    "",
    "Write the commentary now.",
  ].join("\n");

  return { system, user };
}
