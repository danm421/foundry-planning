import { describe, it, expect } from "vitest";
import { revocableTrustFundingGroups } from "../revocable-trust-funding-group";
import type { SolverScenarioChangeDraft } from "../types";

function editTrust(id: string, to: string | null): SolverScenarioChangeDraft {
  return {
    opType: "edit",
    targetKind: "account",
    targetId: id,
    payload: { revocableTrustName: { from: null, to } },
    orderIndex: 0,
  };
}

describe("revocableTrustFundingGroups", () => {
  it("buckets >=2 accounts funding the same trust into one group", () => {
    const groups = revocableTrustFundingGroups([
      editTrust("a", "Family Trust"),
      editTrust("b", "Family Trust"),
    ]);
    expect(groups).toEqual([
      { name: "Move into Family Trust", targetIds: ["a", "b"] },
    ]);
  });

  it("ignores a lone funded account (already one change)", () => {
    expect(revocableTrustFundingGroups([editTrust("a", "Family Trust")])).toEqual([]);
  });

  it("makes one group per distinct trust name", () => {
    const groups = revocableTrustFundingGroups([
      editTrust("a", "Trust One"),
      editTrust("b", "Trust One"),
      editTrust("c", "Trust Two"),
      editTrust("d", "Trust Two"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.name).sort()).toEqual([
      "Move into Trust One",
      "Move into Trust Two",
    ]);
  });

  it("ignores clears, non-account edits, and unrelated account fields", () => {
    const groups = revocableTrustFundingGroups([
      editTrust("a", null), // un-tag → no funding
      { opType: "edit", targetKind: "income", targetId: "i", payload: { revocableTrustName: { from: null, to: "X" } }, orderIndex: 0 },
      { opType: "edit", targetKind: "account", targetId: "b", payload: { annualAmount: { from: 1, to: 2 } }, orderIndex: 0 },
      editTrust("c", "Family Trust"), // only 1 real funder → no group
    ]);
    expect(groups).toEqual([]);
  });

  it("reads the trust name from an add draft's full-entity payload", () => {
    const groups = revocableTrustFundingGroups([
      { opType: "add", targetKind: "account", targetId: "a", payload: { id: "a", revocableTrustName: "Family Trust" }, orderIndex: 0 },
      editTrust("b", "Family Trust"),
    ]);
    expect(groups).toEqual([
      { name: "Move into Family Trust", targetIds: ["a", "b"] },
    ]);
  });
});
