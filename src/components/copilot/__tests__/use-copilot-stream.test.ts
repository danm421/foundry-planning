// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseCopilotSse, type CopilotSseEvent } from "../use-copilot-stream";

/** Feed a sequence of raw chunks through the stateful boundary parser. */
function drain(chunks: string[]): CopilotSseEvent[] {
  let buffer = "";
  const out: CopilotSseEvent[] = [];
  for (const chunk of chunks) {
    buffer += chunk;
    const it = parseCopilotSse(buffer);
    let next = it.next();
    while (!next.done) {
      out.push(next.value);
      next = it.next();
    }
    buffer = next.value as string; // leftover partial frame carried forward
  }
  return out;
}

describe("parseCopilotSse", () => {
  it("handles a frame split across two chunks without dropping or duplicating", () => {
    const events = drain([
      // chunk A: a complete conversation frame + the START of a token frame
      `data: {"type":"conversation","conversationId":"c9"}\n\ndata: {"type":"to`,
      // chunk B: the REST of the token frame + tool_start + tool_end + done
      `ken","text":"Hello"}\n\ndata: {"type":"tool_start","name":"run_monte_carlo"}\n\ndata: {"type":"tool_end","name":"run_monte_carlo"}\n\ndata: {"type":"done"}\n\n`,
    ]);

    expect(events).toEqual([
      { type: "conversation", conversationId: "c9" },
      { type: "token", text: "Hello" },
      { type: "tool_start", name: "run_monte_carlo" },
      { type: "tool_end", name: "run_monte_carlo" },
      { type: "done" },
    ]);
  });

  it("emits nothing until a full frame boundary is seen", () => {
    const events = drain([`data: {"type":"token","text":"par`]);
    expect(events).toEqual([]);
  });

  it("parses an approval_required frame with previews and calls", () => {
    const events = drain([
      `data: {"type":"approval_required","previews":[{"summary":"Add Roth conversion","name":"propose_changes"}],"calls":[{"id":"t1","name":"propose_changes","args":{}}]}\n\n`,
    ]);
    expect(events).toEqual([
      {
        type: "approval_required",
        previews: [{ summary: "Add Roth conversion", name: "propose_changes" }],
        calls: [{ id: "t1", name: "propose_changes", args: {} }],
      },
    ]);
  });
});
