// src/domain/forge/verify.ts
//
// The verification pass: a no-tool-call answer containing a number is routed
// here (see routing.ts) and checked before it streams. Tier 1 is the free
// deterministic grounding check; Tier 2 is an independent mini-model critic.
// One retry, then release with a caveat. See the design spec.
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";
import { chatModel } from "./llm";
import { findUngroundedNumbers } from "./grounding";
import { selectHistoryWindow } from "./history-window";
import type { ForgeState, VerifyDecision } from "./state";

export const MAX_VERIFY_RETRIES = 1;
const CRITIC_TIMEOUT_MS = 10_000;

export const VERIFY_CAVEAT =
  "I'm not fully confident in the figures above — please double-check them against the plan before relying on them.";

const CriticVerdictSchema = z.object({
  ok: z.boolean(),
  problems: z.array(z.string()),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

const CRITIC_SYSTEM = [
  "You are a meticulous reviewer of a financial-planning assistant's draft answer.",
  "You are given the advisor's question, the raw tool results the assistant had, and the draft answer.",
  "Confirm every figure and claim in the draft is SUPPORTED by the tool results and that any",
  "arithmetic or interpretation between results is correct.",
  "Flag ONLY substantive errors: figures unsupported by the tool results, wrong arithmetic, or",
  "misread/misattributed results. Do NOT flag style, tone, phrasing, or omissions.",
  "When the draft is well-supported, return ok=true with an empty problems list.",
].join(" ");

/** Independent mini critic. FAILS OPEN (ok=true) on any error or timeout — a
 *  critic outage must never dead-end the assistant; Tier 1 already ran. */
export async function runCritic(input: {
  question: string;
  toolResults: string;
  answer: string;
}): Promise<CriticVerdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const model = chatModel("mini").withStructuredOutput(CriticVerdictSchema);
    const user = [
      `ADVISOR QUESTION:\n${input.question}`,
      `TOOL RESULTS:\n${input.toolResults || "(none)"}`,
      `DRAFT ANSWER:\n${input.answer}`,
    ].join("\n\n");
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("critic_timeout")), CRITIC_TIMEOUT_MS);
    });
    const verdict = (await Promise.race([
      model.invoke([new SystemMessage(CRITIC_SYSTEM), new HumanMessage(user)]),
      timeout,
    ])) as CriticVerdict;
    return verdict;
  } catch {
    return { ok: true, problems: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Tool-result payload strings visible in the current model window. */
export function windowToolResults(messages: BaseMessage[]): string[] {
  return selectHistoryWindow(messages)
    .filter((m): m is ToolMessage => m instanceof ToolMessage)
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
}

/** Two-tier evaluation. Tier 1 (deterministic, free) short-circuits a fail
 *  before spending a critic call; Tier 2 is the mini critic. */
export async function evaluateAnswer(input: {
  question: string;
  answer: string;
  toolResults: string[];
}): Promise<CriticVerdict> {
  const ungrounded = findUngroundedNumbers(input.answer, input.toolResults);
  if (ungrounded.length > 0) {
    return {
      ok: false,
      problems: [`These figures don't trace to the data: ${ungrounded.join(", ")}.`],
    };
  }
  return runCritic({
    question: input.question,
    toolResults: input.toolResults.join("\n\n"),
    answer: input.answer,
  });
}

function lastHumanQuestion(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m instanceof HumanMessage) return typeof m.content === "string" ? m.content : "";
  }
  return "";
}

/** The verify graph node. Returns the routing decision in state (read by the
 *  verify→(agent|END) conditional edge) and signals the SSE route via custom
 *  events so it knows when to flush the held answer buffer. */
export async function verifyNode(
  state: typeof ForgeState.State,
  config?: LangGraphRunnableConfig,
): Promise<{ verifyDecision: VerifyDecision; verifyAttempts?: number; messages?: BaseMessage[] }> {
  await dispatchCustomEvent("forge_verify", { result: "start" }, config);

  const messages = state.messages;
  const last = messages[messages.length - 1] as AIMessage;
  const answer = typeof last.content === "string" ? last.content : "";

  const verdict = await evaluateAnswer({
    question: lastHumanQuestion(messages),
    answer,
    toolResults: windowToolResults(messages),
  });

  if (verdict.ok) {
    await dispatchCustomEvent("forge_verify", { result: "pass" }, config);
    return { verifyDecision: "pass" };
  }

  if (state.verifyAttempts < MAX_VERIFY_RETRIES) {
    await dispatchCustomEvent("forge_verify", { result: "retry" }, config);
    const critique = new HumanMessage(
      `A reviewer flagged the previous answer: ${verdict.problems.join(" ")} ` +
        `Recheck against the tool results — recompute if needed — and revise your answer.`,
    );
    return {
      verifyDecision: "retry",
      verifyAttempts: state.verifyAttempts + 1,
      messages: [critique],
    };
  }

  await dispatchCustomEvent("forge_verify", { result: "caveat", caveat: VERIFY_CAVEAT }, config);
  return { verifyDecision: "caveat" };
}
