import { describe, it, expect, vi } from "vitest";

const dispatch = vi.fn();
vi.mock("@langchain/core/callbacks/dispatch", () => ({
  dispatchCustomEvent: (...a: unknown[]) => dispatch(...a),
}));

import { buildWalkthroughTools } from "../walkthrough";

const CTX = { ctx: { userId: "u1", firmId: "org1" }, conversationId: "c1" };

describe("start_walkthrough tool", () => {
  it("exposes exactly start_walkthrough", () => {
    const names = buildWalkthroughTools(CTX as never).map((t) => t.name);
    expect(names).toEqual(["start_walkthrough"]);
  });

  it("emits a walkthrough frame for a real id and reports started", async () => {
    const [tool] = buildWalkthroughTools(CTX as never);
    const out = await tool.invoke({ walkthroughId: "add-household" });
    expect(dispatch).toHaveBeenCalledWith("walkthrough", { walkthroughId: "add-household" });
    expect(JSON.parse(out as string)).toEqual({ started: true, walkthroughId: "add-household" });
  });

  it("returns an error (no throw) for an unknown id", async () => {
    const [tool] = buildWalkthroughTools(CTX as never);
    const out = await tool.invoke({ walkthroughId: "nope" });
    expect(JSON.parse(out as string)).toHaveProperty("error");
  });
});
