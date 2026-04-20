/**
 * Robust JSON parser for AI model responses.
 * Handles markdown fences, reasoning model thinking text, and malformed output.
 * Ported from ethos-tools/tools/emoney/_common.py parse_ai_response().
 */
export function parseAIResponse(raw: string): Record<string, unknown> {
  if (!raw) return {};

  let text = raw.trim();

  // Strip markdown code fences at the very start
  if (text.startsWith("```")) {
    const lines = text.split("\n");
    if (lines[lines.length - 1].trim() === "```") {
      text = lines.slice(1, -1).join("\n");
    } else {
      text = lines.slice(1).join("\n");
    }
  }

  // 1. Direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue to fallbacks
  }

  // 2. Find ```json ... ``` blocks (try last block first)
  const jsonBlocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(
    (m) => m[1].trim()
  );
  for (let i = jsonBlocks.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(jsonBlocks[i]);
    } catch {
      continue;
    }
  }

  // 3. Balanced brace matching from end
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace !== -1) {
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, lastBrace + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  // 4. First { to last } fallback
  const firstBrace = text.indexOf("{");
  const lastBrace2 = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace2 > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace2 + 1));
    } catch {
      // fall through
    }
  }

  return {};
}
