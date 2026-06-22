// src/domain/forge/__tests__/transcript.test.ts
import { describe, it, expect } from "vitest";
import {
  HumanMessage,
  AIMessage,
  AIMessageChunk,
  ToolMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { toUiMessages } from "../transcript";

describe("toUiMessages", () => {
  it("keeps user and assistant prose, drops tool and system messages (round-trip of a full turn)", () => {
    const out = toUiMessages([
      new SystemMessage("you are foundry forge"),
      new HumanMessage("how is the retirement plan tracking?"),
      new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "run_projection", args: {} }] }),
      new ToolMessage({ tool_call_id: "c1", content: "{...}" }),
      new AIMessage("The plan funds through age 95 in the base case."),
    ]);
    expect(out).toEqual([
      { role: "user", text: "how is the retirement plan tracking?" },
      { role: "assistant", text: "The plan funds through age 95 in the base case." },
    ]);
  });

  it("skips empty assistant tool-call turns and trims whitespace", () => {
    const out = toUiMessages([
      new HumanMessage("  hi  "),
      new AIMessage({ content: "   ", tool_calls: [{ id: "c1", name: "x", args: {} }] }),
    ]);
    expect(out).toEqual([{ role: "user", text: "hi" }]);
  });

  it("keeps a streamed assistant reply reloaded as an AIMessageChunk", () => {
    // A streaming model's invoke() aggregates deltas into an AIMessageChunk, so
    // that is the shape the assistant turn is checkpointed (and reloaded) as —
    // NOT a plain AIMessage. Reloading a past conversation must still surface it.
    const out = toUiMessages([
      new HumanMessage("what capabilities do you have"),
      new AIMessageChunk("I can help you explore the plan."),
    ]);
    expect(out).toEqual([
      { role: "user", text: "what capabilities do you have" },
      { role: "assistant", text: "I can help you explore the plan." },
    ]);
  });

  it("flattens content-part arrays to text", () => {
    const out = toUiMessages([
      new AIMessage({ content: [{ type: "text", text: "part one " }, { type: "text", text: "part two" }] }),
    ]);
    expect(out).toEqual([{ role: "assistant", text: "part one part two" }]);
  });
});
