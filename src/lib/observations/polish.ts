// Tone-only rewrite of a single observation/next-step body. Synchronous —
// one mini-model call, no fact-sheet assembly. Mirrors the prompt+call split
// in src/lib/observations/draft.ts (SYSTEM_PROMPT + generateObservationsDraft)
// so every AI-calling route in this tree keeps the prompt out of the
// transport layer.
import { callAIExtraction } from "@/lib/extraction/azure-client";

export const POLISH_SYSTEM_PROMPT =
  "Rewrite for a client-facing financial plan: clear, warm, concise. " +
  "Preserve every {{token}} exactly as written. Return only the rewritten markdown.";

export async function polishObservationBody(body: string): Promise<string> {
  const rewritten = await callAIExtraction(POLISH_SYSTEM_PROMPT, body);
  return rewritten.trim();
}
