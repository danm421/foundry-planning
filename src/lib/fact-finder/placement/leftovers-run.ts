// src/lib/fact-finder/placement/leftovers-run.ts
/**
 * The leftovers step's one model call (D10). Server-only: the model runs on
 * the firm's credentials. It fails soft — not set up, a timeout, output that
 * doesn't fit the schema: null, and the review builds its change list without
 * the AI and names the notes it didn't place.
 */
import "server-only";
import { HumanMessage, SystemMessage, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import { chatModel } from "@/domain/forge/llm";
import { recordAiUsage, usageStage } from "@/lib/ai/usage";
import { buildLeftoversPrompt, LeftoversOutputSchema, type LeftoversOutput } from "./leftovers";
import type { LeftoverItem, TargetDraft } from "./types";

/** The review waits this long for the AI; past it, the change list builds without it. */
const LEFTOVERS_TIMEOUT_MS = 90_000;

/** Bill the call to the review's usage scope, as the chat turn bills each round trip (LangChain records nothing itself). */
function recordLeftoversUsage(raw: AIMessage): void {
  const usage = raw.usage_metadata;
  recordAiUsage({
    model: String(raw.response_metadata?.model_name ?? "chat"),
    promptTokens: usage?.input_tokens,
    completionTokens: usage?.output_tokens,
    cachedPromptTokens: usage?.input_token_details?.cache_read,
  });
}

export async function runLeftovers(items: readonly LeftoverItem[], drafts: readonly TargetDraft[]): Promise<LeftoversOutput | null> {
  if (items.length === 0) return null;
  const { system, user } = buildLeftoversPrompt(items, drafts);
  try {
    const model = (await chatModel("full")).withStructuredOutput<LeftoversOutput>(LeftoversOutputSchema, {
      name: "fact_finder_leftovers",
      includeRaw: true,
    });
    const parsed = await usageStage("fact-finder-leftovers", async () => {
      // With includeRaw a reply that doesn't fit the schema comes back as `parsed: null`, not a throw.
      const reply: { raw: BaseMessage; parsed: LeftoversOutput | null } = await model.invoke(
        [new SystemMessage(system), new HumanMessage(user)],
        { signal: AbortSignal.timeout(LEFTOVERS_TIMEOUT_MS) },
      );
      recordLeftoversUsage(reply.raw as AIMessage);
      return reply.parsed;
    });
    if (parsed === null) console.error("[fact-finder-review] leftovers step failed: the reply didn't fit the schema");
    return parsed;
  } catch (err) {
    console.error("[fact-finder-review] leftovers step failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    return null;
  }
}
