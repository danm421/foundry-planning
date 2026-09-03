// promptfoo library-mode provider that runs the REAL forge graph offline with a
// MemorySaver and stubbed scope (the graph.test.ts path). Returns the assistant
// text plus the ordered tool-call trajectory so trajectory:* assertions can read
// it. No live Clerk/DB/Azure — the caller mocks ../llm, or runs against the
// no-temperature Azure deployment configured in promptfoo.yaml.
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage, type AIMessage } from "@langchain/core/messages";
import { buildGraph } from "../graph";
import { EVAL_AUTH, EVAL_AUTH_GLOBAL, evalSystemPrompt } from "./fixtures";

export interface ForgeTrajectoryStep {
  tool: string;
  args: Record<string, unknown>;
  /** True only when the tool actually EXECUTED (on_tool_start). A proposed write
   *  captured pre-approval (on_chat_model_end) stays unmarked. The HITL invariant
   *  in assertions.ts reads this to detect a write that ran without approval. */
  executed?: boolean;
}
export interface ForgeTurnResult {
  output: string;
  trajectory: ForgeTrajectoryStep[];
}

let counter = 0;

export async function runForgeTurn(
  message: string,
  mode?: string,
): Promise<ForgeTurnResult> {
  const auth = mode === "global" ? EVAL_AUTH_GLOBAL : EVAL_AUTH;
  const threadId = `eval_${counter++}`;
  const graph = buildGraph(auth, new MemorySaver(), threadId, evalSystemPrompt);

  const trajectory: ForgeTrajectoryStep[] = [];
  let output = "";
  // Proposed calls are captured twice (on_chat_model_end, then the pending
  // interrupt) — dedup by CALL id, never by tool name, or a batch of N
  // same-tool calls collapses to one entry and the batch cases prove nothing.
  const seen = new Set<string>();
  const remember = (name: string, args: Record<string, unknown>, id?: string) => {
    const key = id ?? `${name}:${JSON.stringify(args)}`;
    if (seen.has(key)) return;
    seen.add(key);
    trajectory.push({ tool: name, args });
  };

  const events = graph.streamEvents(
    { messages: [new HumanMessage(message)], authContext: auth },
    { version: "v2", configurable: { thread_id: threadId }, recursionLimit: 25 },
  );
  for await (const ev of events) {
    if (ev.event === "on_tool_start") {
      trajectory.push({
        tool: ev.name ?? "unknown",
        args: (ev.data?.input ?? {}) as Record<string, unknown>,
        executed: true,
      });
    } else if (ev.event === "on_chat_model_end") {
      const msg = ev.data?.output as AIMessage | undefined;
      // capture proposed (un-executed) write tool calls too, for HITL assertions
      for (const c of msg?.tool_calls ?? []) {
        remember(c.name, c.args as Record<string, unknown>, c.id);
      }
    } else if (ev.event === "on_chat_model_stream") {
      const chunk = ev.data?.chunk;
      if (typeof chunk?.content === "string") output += chunk.content;
    }
  }

  // A write tool interrupts before executing, so its proposed call never surfaces
  // as on_tool_start (and a mock model emits no on_chat_model_end). Read it from
  // the pending interrupt — the same place the stream/resume routes read it — so
  // the trajectory captures proposed writes for the HITL invariant.
  const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
  const pending = snapshot.tasks?.find((t: { interrupts?: unknown[] }) => t.interrupts?.length);
  if (pending) {
    const value = (pending.interrupts as Array<{ value?: { calls?: unknown } }>)[0]?.value;
    const calls = (value?.calls ?? []) as Array<{ id?: string; name?: string; args?: unknown }>;
    for (const c of calls) {
      remember(c.name ?? "unknown", (c.args ?? {}) as Record<string, unknown>, c.id);
    }
  }

  return { output, trajectory };
}

/** promptfoo custom provider (callApi contract). promptfoo instantiates a
 *  `file://` provider with `new`, so this must be a class — a plain object
 *  fails at load time ("(intermediate value) is not a constructor") before any
 *  case runs, which is what kept `npm run eval:forge` from ever starting. */
export default class ForgeGraphProvider {
  id(): string {
    return "forge-graph";
  }

  async callApi(prompt: string, context?: { vars?: Record<string, unknown> }) {
    const mode = context?.vars?.mode as string | undefined;
    const { output, trajectory } = await runForgeTurn(prompt, mode);
    return { output, metadata: { trajectory } };
  }
}
