import { describe, it, expect } from "vitest";
import { computeRowDiff } from "@/lib/scenario/diff-row";

describe("computeRowDiff", () => {
  it("returns 'unchanged' when base and effective are identical", () => {
    const r = computeRowDiff({ id: "1", amount: 100 }, { id: "1", amount: 100 });
    expect(r.kind).toBe("unchanged");
  });

  it("returns 'edit' with field-level diffs when fields differ", () => {
    const r = computeRowDiff(
      { id: "1", amount: 100, name: "X" },
      { id: "1", amount: 200, name: "X" },
    );
    expect(r.kind).toBe("edit");
    if (r.kind !== "edit") throw new Error("expected edit");
    expect(r.fields).toEqual([{ field: "amount", from: 100, to: 200 }]);
  });

  it("returns 'add' when base is null", () => {
    const r = computeRowDiff(null, { id: "1", amount: 100 });
    expect(r.kind).toBe("add");
  });

  it("returns 'remove' when effective is null", () => {
    const r = computeRowDiff({ id: "1", amount: 100 }, null);
    expect(r.kind).toBe("remove");
  });

  it("returns 'unchanged' when both base and effective are null", () => {
    const r = computeRowDiff(null, null);
    expect(r.kind).toBe("unchanged");
  });

  it("ignores meta fields (id, createdAt, updatedAt, scenarioId)", () => {
    const r = computeRowDiff(
      {
        id: "1",
        amount: 100,
        createdAt: new Date("2024-01-01").toISOString(),
        updatedAt: new Date("2024-01-01").toISOString(),
        scenarioId: "base",
      },
      {
        id: "1",
        amount: 100,
        createdAt: new Date("2025-06-15").toISOString(),
        updatedAt: new Date("2025-06-15").toISOString(),
        scenarioId: "scn-A",
      },
    );
    expect(r.kind).toBe("unchanged");
  });
});
