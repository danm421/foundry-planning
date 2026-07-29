import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { chatModel } from "@/domain/forge/llm";
import type { ImportPayload } from "../types";
import { buildPlannerTools, type EstimatePiaToolInput } from "./tools";
import { PLANNER_SYSTEM_PROMPT } from "./prompt";
import type { PlanningDecisions } from "./types";

const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_TIMEOUT_MS = 90_000;

export interface RunPlannerArgs {
  documentText: string;
  pages: string[];
  payload: ImportPayload;
  estimatePia: (input: EstimatePiaToolInput) => number;
  maxIterations?: number;
  timeoutMs?: number;
  /** Injected in tests. Defaults to the Azure tool-calling deployment. */
  model?: BaseChatModel;
}

/**
 * Bounded agentic planner. Reads the document, inspects what extraction
 * produced, and proposes a PlanningDecisions.
 *
 * NEVER THROWS. Assemble runs this opportunistically: a timeout, an Azure
 * outage, a malformed proposal, or an unconfigured environment all resolve to
 * null, and the caller proceeds with deterministic behaviour. A reasoning layer
 * that can take down plan-building is worse than no reasoning layer.
 */
export async function runPlanner(args: RunPlannerArgs): Promise<PlanningDecisions | null> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([loop(args), deadline]);
  } catch (err) {
    console.warn(
      `[planner] aborted: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`,
    );
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loop(args: RunPlannerArgs): Promise<PlanningDecisions | null> {
  const { tools, getProposal } = buildPlannerTools({
    documentText: args.documentText,
    pages: args.pages,
    payload: args.payload,
    estimatePia: args.estimatePia,
  });
  const byName = new Map(tools.map((t) => [t.name, t]));

  // chatModel() throws "ai_not_configured" when env is missing - callers get
  // null from runPlanner's catch, which is the correct degrade.
  const baseModel = args.model ?? chatModel("full");
  if (typeof baseModel.bindTools !== "function") {
    // BaseChatModel declares bindTools as optional; every model we actually
    // pass here implements it, but assert rather than risk a silent `any`.
    throw new Error("planner model does not support tool calling");
  }
  const model = baseModel.bindTools(tools);

  const messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [
    new SystemMessage(PLANNER_SYSTEM_PROMPT),
    new HumanMessage(
      "Analyse the uploaded document and propose planning decisions. " +
        "Start by reading it, then inspect what extraction produced, then call " +
        "propose_decisions exactly once.",
    ),
  ];

  const maxIterations = args.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  for (let i = 0; i < maxIterations; i += 1) {
    const reply = (await model.invoke(messages)) as AIMessage;
    messages.push(reply);

    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) break;

    for (const call of calls) {
      const tool = byName.get(call.name);
      const output = tool
        ? await tool.invoke(call.args as never)
        : `Unknown tool "${call.name}".`;
      messages.push(new ToolMessage({ content: String(output), tool_call_id: call.id ?? call.name }));
    }

    const proposal = getProposal();
    if (proposal) return proposal;
  }

  return getProposal();
}
