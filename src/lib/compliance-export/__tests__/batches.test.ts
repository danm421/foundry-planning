import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ counts: vi.fn(), update: vi.fn() }));

// childStatusCounts uses select().from().where().groupBy(); finalize/mark use
// update().set().where(). We stub both chains.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ groupBy: () => m.counts() }) }),
    }),
    update: () => ({ set: (v: unknown) => ({ where: () => m.update(v) }) }),
  },
}));

import { childStatusCounts, finalizeBatchIfComplete } from "../batches";

beforeEach(() => {
  m.counts.mockReset();
  m.update.mockReset();
  m.update.mockResolvedValue(undefined);
});

describe("childStatusCounts", () => {
  it("maps grouped rows into a full count object with zeros", async () => {
    m.counts.mockResolvedValue([
      { status: "done", count: 5 },
      { status: "failed", count: 2 },
    ]);
    const c = await childStatusCounts("b1");
    expect(c).toEqual({ queued: 0, running: 0, analyzing: 0, done: 5, failed: 2 });
  });
});

describe("finalizeBatchIfComplete", () => {
  it("does nothing while runs are still in flight", async () => {
    m.counts.mockResolvedValue([{ status: "running", count: 1 }, { status: "done", count: 3 }]);
    await finalizeBatchIfComplete("b1");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("marks done when all children succeeded", async () => {
    m.counts.mockResolvedValue([{ status: "done", count: 4 }]);
    await finalizeBatchIfComplete("b1");
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done" }),
    );
  });

  it("marks done_with_errors when any child failed", async () => {
    m.counts.mockResolvedValue([{ status: "done", count: 4 }, { status: "failed", count: 1 }]);
    await finalizeBatchIfComplete("b1");
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done_with_errors" }),
    );
  });
});
