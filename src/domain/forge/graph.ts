// src/domain/copilot/graph.ts
import { StateGraph, START, END, interrupt } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { ForgeState, type ForgeAuthContext } from "./state";
import { chatModel } from "./llm"; // Phase 0 infra section: AzureChatOpenAI factory
import { buildTools, WRITE_TOOL_NAMES } from "./tools";
import { buildToolContext } from "./context";
import { routeAfterAgent } from "./routing";
import { selectHistoryWindow } from "./history-window";
import { describeProposedWrite } from "@/domain/forge/preview";
import { recordAudit } from "@/lib/audit";

/**
 * Compile the copilot graph for one conversation.
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
  const tools = buildTools(buildToolContext(authContext, conversationId));
  const model = chatModel().bindTools(tools);
  const toolNode = new ToolNode(tools);
  // Map for the approval node to invoke a confirmed write tool by name. The args
  // come from the model's validated tool_calls, so the uniform invoke signature
  // is safe to unify across the tool union.
  const toolsByName = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t]));

  async function agentNode(state: typeof ForgeState.State) {
    const system = new SystemMessage(systemPrompt());
    // The full thread is checkpointed; only send a bounded recent window so
    // token cost/latency don't grow. The system prompt is the stable prefix
    // (good for Azure's automatic prompt caching).
    const window = selectHistoryWindow(state.messages);
    const response = await model.invoke([system, ...window]);
    return { messages: [response] };
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
    const decision = interrupt({
      type: "approval_required",
      previews,
      calls: writeCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
    }) as { decisions: Record<string, "confirm" | "reject"> };

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
        action: "copilot.write_proposed",
        resourceType: "copilot_conversation",
        resourceId: conversationId,
        clientId: ctx.clientId,
        firmId: ctx.firmId,
        metadata: { tool: c.name, toolCallId: c.id },
      });
    }

    const messages: ToolMessage[] = [];
    for (const c of last.tool_calls ?? []) {
      // Azure always populates tool_call ids; guard malformed model output so a
      // missing id can't silently reject a confirmed write or break tool pairing.
      const id = c.id;
      if (!id) continue;
      if (WRITE_TOOL_NAMES.has(c.name)) {
        const verdict = decision.decisions[id] ?? "reject";
        if (verdict === "confirm") {
          // The tool emits copilot.write_approved itself, only on real success.
          const t = toolsByName.get(c.name)!;
          const result = await t.invoke(c.args);
          messages.push(new ToolMessage({ tool_call_id: id, content: String(result) }));
        } else {
          await recordAudit({
            action: "copilot.write_rejected",
            resourceType: "copilot_conversation",
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
        const result = t ? await t.invoke(c.args) : "Unknown tool.";
        messages.push(new ToolMessage({ tool_call_id: id, content: String(result) }));
      }
    }
    return { messages };
  }

  const graph = new StateGraph(ForgeState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addNode("approval", approvalNode)
    .addEdge(START, "agent")
    .addEdge("tools", "agent")
    .addEdge("approval", "agent")
    .addConditionalEdges(
      "agent",
      (state) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        const calls = (last.tool_calls ?? []).map((c) => ({ name: c.name }));
        const route = routeAfterAgent(calls, WRITE_TOOL_NAMES);
        return route === "__end__" ? END : route;
      },
      { tools: "tools", approval: "approval", [END]: END },
    );

  return graph.compile({ checkpointer });
}
