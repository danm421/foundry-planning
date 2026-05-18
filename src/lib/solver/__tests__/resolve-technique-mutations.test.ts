import { describe, it, expect } from "vitest";
import type { ClientData, Reinvestment } from "@/engine/types";
import { resolveTechniqueMutations } from "../resolve-technique-mutations";

const emptyCtx = { resolver: { resolve: () => 0.06 }, accountBaseAllocByAccountId: new Map() } as never;

function treeWith(reinvestments: Reinvestment[]): ClientData {
  return { reinvestments } as unknown as ClientData;
}

describe("resolveTechniqueMutations", () => {
  it("returns the tree unchanged when no reinvestment-upsert is present", () => {
    const tree = treeWith([]);
    const out = resolveTechniqueMutations(
      tree,
      [{ kind: "roth-conversion-upsert", id: "rc-1", value: null }],
      emptyCtx,
    );
    expect(out).toBe(tree);
  });

  it("re-resolves reinvestments when a reinvestment-upsert is present", () => {
    const ri = {
      id: "ri-1",
      name: "RI",
      accountIds: ["acc-1"],
      year: 2030,
      newGrowthRate: 0,
      realizeTaxesOnSwitch: false,
      soldFractionByAccount: {},
      targetType: "custom" as const,
      customGrowthRate: 0.07,
    } as unknown as Reinvestment;
    const out = resolveTechniqueMutations(
      treeWith([ri]),
      [{ kind: "reinvestment-upsert", id: "ri-1", value: ri }],
      emptyCtx,
    );
    expect(out.reinvestments?.[0].newGrowthRate).toBe(0.07);
  });
});
