import { describe, it, expect, vi } from "vitest";
import { listCheckpoints, undoToCheckpoint } from "../time-travel";
import type { ForgeAuthContext } from "../state";

const auth: ForgeAuthContext = { userId: "u1", firmId: "f1", clientId: "c1", scenarioId: "base" };

describe("listCheckpoints", () => {
  it("maps state history into summaries newest-first", async () => {
    async function* history() {
      yield { config: { configurable: { checkpoint_id: "c2" } }, createdAt: "2026-06-17T10:01:00Z", values: { messages: [1, 2] } };
      yield { config: { configurable: { checkpoint_id: "c1" } }, createdAt: "2026-06-17T10:00:00Z", values: { messages: [1] } };
    }
    const graph = { getStateHistory: () => history() } as never;
    const out = await listCheckpoints("conv_1", graph);
    expect(out.map((c) => c.checkpointId)).toEqual(["c2", "c1"]);
    expect(out[0].messageCount).toBe(2);
  });
});

describe("undoToCheckpoint", () => {
  it("updates state at the target checkpoint, reasserting the scope", async () => {
    const updateState = vi.fn(async () => ({}));
    const graph = { updateState } as never;
    await undoToCheckpoint("conv_1", "c1", auth, graph);
    expect(updateState).toHaveBeenCalledWith(
      { configurable: { thread_id: "conv_1", checkpoint_id: "c1" } },
      { authContext: auth },
    );
  });
});
