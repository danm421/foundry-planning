// src/domain/forge/graph.ts
import { StateGraph, START, END, interrupt } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver, LangGraphRunnableConfig } from "@langchain/langgraph";
import { ForgeState, type ForgeAuthContext } from "./state";
import { chatModel } from "./llm"; // Phase 0 infra section: AzureChatOpenAI factory
import { buildTools, WRITE_TOOL_NAMES } from "./tools";
import { buildToolContext } from "./context";
import { getStore } from "./store";
import { parseResumeDecisions } from "./interrupts";
import { routeAfterAgent } from "./routing";
import { compactHistory } from "./history-window";
import { classifyIntent } from "./dispatcher";
import { verifyNode } from "./verify";
import { containsNumber } from "./grounding";
import { describeProposedWrite } from "@/domain/forge/preview";
import { recordAudit } from "@/lib/audit";

/** Max consecutive failures of a single tool before the graph escalates instead
 *  of letting the agent retry-loop forever (12-factor Factors 8/9). */
const TOOL_ERROR_ESCALATE_AT = 3;

/** A tool result is a FAILURE if ToolNode marked it status:"error" (a thrown
 *  tool) or the content is JSON carrying a truthy `error` field (tools that
 *  return a sanitized error object rather than throwing). */
function isToolFailure(content: unknown, status?: string): boolean {
  if (status === "error") return true;
  if (typeof content !== "string") return false;
  try {
    const parsed = JSON.parse(content) as unknown;
    return (
      !!parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      !!(parsed as { error?: unknown }).error
    );
  } catch {
    return false;
  }
}

/** Per-tool delta from a batch of tool results: 1 = failed this round, 0 =
 *  succeeded (resets the streak via the toolErrorCounts reducer). */
function countToolResults(messages: ToolMessage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of messages) {
    if (!m.name) continue;
    counts[m.name] = isToolFailure(m.content, m.status) ? 1 : 0;
  }
  return counts;
}

/** After tools/approval execute: escalate when any tool has failed
 *  TOOL_ERROR_ESCALATE_AT times in a row, else hand back to the agent. */
function routeAfterToolExec(state: typeof ForgeState.State): "agent" | "escalate" {
  const counts = state.toolErrorCounts ?? {};
  return Object.values(counts).some((n) => n >= TOOL_ERROR_ESCALATE_AT) ? "escalate" : "agent";
}

/**
 * Compile the forge graph for one conversation.
 *
 * @param authContext server-derived firm/client/scenario scope (also seeded into state).
 * @param checkpointer PostgresSaver (prod) / MemorySaver (tests), keyed by thread_id.
 * @param conversationId thread id == checkpointer thread_id.
 * @param systemPrompt thunk returning the fully-assembled system prompt string.
 *   Supplied by the route (which has DB/Clerk access) so graph.ts stays pure.
 */
export function buildGraph(
  authContext: ForgeAuthContext,
  checkpointer: BaseCheckpointSaver,
  conversationId: string,
  systemPrompt: () => string,
) {
  const toolCtx = buildToolContext(authContext, conversationId);
  const tools = buildTools(toolCtx);
  const model = chatModel().bindTools(tools);
  const toolNode = new ToolNode(tools);
  // Map for the approval node to invoke a confirmed write tool by name. The args
  // come from the model's validated tool_calls, so the uniform invoke signature
  // is safe to unify across the tool union.
  const toolsByName = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t]));

  async function agentNode(state: typeof ForgeState.State) {
    const system = new SystemMessage(systemPrompt());
    // The full thread is checkpointed; only send a bounded recent window so
    // token cost/latency don't grow, with a numeric-preserving summary prepended
    // when older turns are trimmed. The system prompt is the stable prefix (good
    // for Azure's automatic prompt caching).
    const window = compactHistory(state.messages);
    // Flag-gated multi-model tiering: a cheap mini-model classifies which tool
    // bundles the turn needs, so the full model is bound only to those. Default
    // OFF (validate via the eval harness before enabling); classifyIntent has a
    // full-tool fallback so a misclassification never hides every tool.
    let turnModel = model;
    if (process.env.FORGE_TIERING_ENABLED === "true") {
      const lastHuman = [...state.messages].reverse().find((m) => m instanceof HumanMessage);
      const text =
        lastHuman && typeof lastHuman.content === "string" ? lastHuman.content : "";
      const bundles = await classifyIntent(text);
      turnModel = chatModel().bindTools(buildTools(toolCtx, bundles));
    }
    const response = await turnModel.invoke([system, ...window]);
    return { messages: [response] };
  }

  // Wrap the prebuilt ToolNode so we keep its on_tool_start/on_tool_end events
  // (the routes forward them as status frames) while counting per-tool failures
  // for the escalation edge. Pass config through so the inner tool runs inherit
  // the streamEvents callbacks.
  async function toolsNode(state: typeof ForgeState.State, config?: LangGraphRunnableConfig) {
    const raw = await toolNode.invoke(state, config);
    const messages = (Array.isArray(raw) ? raw : raw.messages) as ToolMessage[];
    return { messages, toolErrorCounts: countToolResults(messages) };
  }

  async function approvalNode(state: typeof ForgeState.State) {
    // authContext is the server-derived scope (firm/client); it's the `ctx`
    // describeProposedWrite + the audit calls below need.
    const ctx = authContext;
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const writeCalls = (last.tool_calls ?? []).filter((c) => WRITE_TOOL_NAMES.has(c.name));
    // Rich, best-effort previews for the approval card (field-level diff + plan
    // impact for propose_changes; pure summary otherwise). describeProposedWrite
    // never throws — its enrichment IO is wrapped in try/catch.
    const previews = await Promise.all(
      writeCalls.map((c) => describeProposedWrite({ name: c.name, args: c.args }, ctx)),
    );

    // Pause; the resume value is { decisions: Record<toolCallId, 'confirm'|'reject'> }.
    // CRITICAL: LangGraph re-runs this node from the top on resume; interrupt()
    // throws on the FIRST pass (so nothing below it runs) and returns the resume
    // value on the SECOND (resume) pass. ALL tool execution AND the write_proposed
    // audit must happen AFTER interrupt() so each fires EXACTLY ONCE.
    const decision = parseResumeDecisions(
      interrupt({
        type: "approval_required",
        previews,
        calls: writeCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
      }),
    );

    // AUDIT OWNERSHIP SPLIT (do not "fix" to also emit write_approved here):
    //   • The NODE emits write_proposed (here, recorded ONCE on the resume pass —
    //     once per resolved proposal regardless of the confirm/reject verdict) and
    //     write_rejected (on a decline, in the decision loop below).
    //   • The write TOOLS own write_approved — they emit it on ACTUAL success
    //     (with the real resourceId). Emitting it here after t.invoke() would
    //     double-audit AND falsely record approval even when the tool returned a
    //     sanitized error string (a failed write), since the tools return error
    //     strings rather than throwing. So write_approved exists iff the write
    //     truly succeeded.
    // This must live AFTER interrupt(): a pre-interrupt loop would fire on both
    // the proposal pass and the resume pass, double-recording write_proposed.
    for (const c of writeCalls) {
      await recordAudit({
        action: "forge.write_proposed",
        resourceType: "forge_conversation",
        resourceId: conversationId,
        clientId: ctx.clientId,
        firmId: ctx.firmId,
        metadata: { tool: c.name, toolCallId: c.id },
      });
    }

    const messages: ToolMessage[] = [];
    // Count executed-tool failures here too (fires once on the resume pass, like
    // the audit above) so a chronically-failing write also drives escalation. A
    // rejection is NOT a failure — only actual execution results are counted.
    const toolErrorCounts: Record<string, number> = {};
    for (const c of last.tool_calls ?? []) {
      // Azure always populates tool_call ids; guard malformed model output so a
      // missing id can't silently reject a confirmed write or break tool pairing.
      const id = c.id;
      if (!id) continue;
      if (WRITE_TOOL_NAMES.has(c.name)) {
        const verdict = decision.decisions[id] ?? "reject";
        if (verdict === "confirm") {
          // The tool emits forge.write_approved itself, only on real success.
          const t = toolsByName.get(c.name)!;
          const content = String(await t.invoke(c.args));
          toolErrorCounts[c.name] = isToolFailure(content) ? 1 : 0;
          messages.push(new ToolMessage({ tool_call_id: id, content }));
        } else {
          await recordAudit({
            action: "forge.write_rejected",
            resourceType: "forge_conversation",
            resourceId: conversationId,
            clientId: ctx.clientId,
            firmId: ctx.firmId,
            metadata: { tool: c.name, toolCallId: c.id },
          });
          messages.push(
            new ToolMessage({ tool_call_id: id, content: "User declined this action." }),
          );
        }
      } else {
        // A read call mixed into a write turn: execute it immediately (no approval needed).
        const t = toolsByName.get(c.name);
        const content = String(t ? await t.invoke(c.args) : "Unknown tool.");
        if (t) toolErrorCounts[c.name] = isToolFailure(content) ? 1 : 0;
        messages.push(new ToolMessage({ tool_call_id: id, content }));
      }
    }
    return { messages, toolErrorCounts };
  }

  async function escalateNode() {
    return {
      messages: [
        new AIMessage(
          "I keep hitting an error with that action. Let's try a different approach or check the inputs.",
        ),
      ],
    };
  }

  const graph = new StateGraph(ForgeState)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addNode("approval", approvalNode)
    .addNode("escalate", escalateNode)
    .addNode("verify", verifyNode)
    .addEdge(START, "agent")
    // tools/approval → agent normally, but → escalate after N consecutive
    // failures of a single tool (deterministic stop instead of a retry loop).
    .addConditionalEdges("tools", routeAfterToolExec, { agent: "agent", escalate: "escalate" })
    .addConditionalEdges("approval", routeAfterToolExec, { agent: "agent", escalate: "escalate" })
    .addEdge("escalate", END)
    .addConditionalEdges(
      "agent",
      (state) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        const calls = (last.tool_calls ?? []).map((c) => ({ name: c.name }));
        const hasNumber = typeof last.content === "string" && containsNumber(last.content);
        const route = routeAfterAgent(calls, WRITE_TOOL_NAMES, hasNumber);
        return route === "__end__" ? END : route;
      },
      { tools: "tools", approval: "approval", verify: "verify", [END]: END },
    )
    .addConditionalEdges(
      "verify",
      (state) => (state.verifyDecision === "retry" ? "agent" : END),
      { agent: "agent", [END]: END },
    );

  // Attach the long-term store so memory tools (and any future store-from-config
  // node) share one PostgresStore. getStore() is a lazy singleton (no connection
  // until a memory tool actually queries), so this is safe at compile time.
  return graph.compile({ checkpointer, store: getStore() });
}
