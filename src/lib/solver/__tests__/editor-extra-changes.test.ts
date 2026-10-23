import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { HeldChangeMutation, SolverMutation } from "../types";

vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));

import { loadEffectiveTree } from "@/lib/scenario/loader";
import { editorExtraChanges } from "../editor-extra-changes";

const CLIENT = "00000000-0000-4000-8000-000000000001";
const FIRM = "firm_1";
const SAVE = "00000000-0000-4000-8000-0000000000b1";

beforeEach(() => vi.clearAllMocks());

describe("editorExtraChanges", () => {
  it("no mutations → [] without loading anything", async () => {
    expect(await editorExtraChanges(CLIENT, FIRM, "base", [])).toEqual([]);
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("opens on held values and controls", async () => {
    const tree = buildClientData();
    const groceries = { ...tree.expenses[0], id: "groceries", name: "Groceries", annualAmount: 12_100 };
    // The tree the loader returns already carries the held edit ($12,100).
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { ...tree, expenses: [groceries] },
      warnings: [],
    } as never);

    const held: HeldChangeMutation = {
      kind: "held-change",
      op: "edit",
      targetKind: "expense",
      targetId: "groceries",
      payload: { annualAmount: { from: 10_000, to: 12_100 } },
      saveId: SAVE,
    };
    const control: SolverMutation = { kind: "expense-annual-amount", expenseId: "groceries", annualAmount: 13_000 };

    const out = await editorExtraChanges(CLIENT, FIRM, "base", [held, control]);

    expect(vi.mocked(loadEffectiveTree).mock.calls[0].slice(0, 4)).toEqual([CLIENT, FIRM, "base", {}]);
    const edits = out.filter((c) => c.targetKind === "expense" && c.targetId === "groceries");
    expect(edits).toHaveLength(1);
    expect(edits[0].opType).toBe("edit");
    expect((edits[0].payload as { annualAmount: { to: number } }).annualAmount.to).toBe(13_000);
  });
});
