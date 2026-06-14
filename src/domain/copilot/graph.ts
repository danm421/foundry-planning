// src/domain/copilot/graph.ts
import { StateGraph, START, END, interrupt } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { CopilotState, type CopilotAuthContext } from "./state";
import { chatModel } from "./llm"; // Phase 0 infra section: AzureChatOpenAI factory
import { buildTools, WRITE_TOOL_NAMES } from "./tools";
import { buildToolContext } from "./context";
import { routeAfterAgent } from "./routing";
import { selectHistoryWindow } from "./history-window";
import type { WritePreview } from "./types"; // SSE-contract preview shape

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
  authContext: CopilotAuthContext,
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

  async function agentNode(state: typeof CopilotState.State) {
    const system = new SystemMessage(systemPrompt());
    // The full thread is checkpointed; only send a bounded recent window so
    // token cost/latency don't grow. The system prompt is the stable prefix
    // (good for Azure's automatic prompt caching).
    const window = selectHistoryWindow(state.messages);
    const response = await model.invoke([system, ...window]);
    return { messages: [response] };
  }

  async function approvalNode(state: typeof CopilotState.State) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const writeCalls = (last.tool_calls ?? []).filter((c) => WRITE_TOOL_NAMES.has(c.name));
    // Phase 0: WRITE_TOOL_NAMES is empty so writeCalls is always []. Phase 2
    // builds rich previews here (describeProposedWrite); until then the preview
    // list is empty and this node is unreachable via routeAfterAgent.
    const previews: WritePreview[] = writeCalls.map((c) => ({
      name: c.name,
      summary: `Proposed ${c.name}`,
    }));
    // Pause; the resume value is { decisions: Record<toolCallId, 'confirm'|'reject'> }.
    // CRITICAL: LangGraph re-runs this node from the top on resume; interrupt()
    // returns the resume value on the SECOND run. ALL tool execution must happen
    // AFTER interrupt() so each write runs EXACTLY ONCE.
    const decision = interrupt({
      type: "approval_required",
      previews,
      calls: writeCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
    }) as { decisions: Record<string, "confirm" | "reject"> };

    const messages: ToolMessage[] = [];
    for (const c of last.tool_calls ?? []) {
      if (WRITE_TOOL_NAMES.has(c.name)) {
        const verdict = decision.decisions[c.id!] ?? "reject";
        if (verdict === "confirm") {
          const t = toolsByName.get(c.name)!;
          const result = await t.invoke(c.args);
          messages.push(new ToolMessage({ tool_call_id: c.id!, content: String(result) }));
        } else {
          messages.push(
            new ToolMessage({ tool_call_id: c.id!, content: "User declined this action." }),
          );
        }
      } else {
        // A read call mixed into a write turn: execute it immediately (no approval needed).
        const t = toolsByName.get(c.name);
        const result = t ? await t.invoke(c.args) : "Unknown tool.";
        messages.push(new ToolMessage({ tool_call_id: c.id!, content: String(result) }));
      }
    }
    return { messages };
  }

  const graph = new StateGraph(CopilotState)
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
