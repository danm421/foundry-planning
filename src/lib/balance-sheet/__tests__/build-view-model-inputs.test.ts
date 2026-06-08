// src/lib/balance-sheet/__tests__/build-view-model-inputs.test.ts
import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import { buildViewModelInputs } from "../build-view-model-inputs";

const tree = {
  accounts: [
    { id: "a1", name: "Checking", category: "cash", titlingType: "jtwros", owners: [{ kind: "family_member", familyMemberId: "c", percent: 1 }] },
  ],
  liabilities: [
    { id: "l1", name: "Mortgage", linkedPropertyId: "h1", owners: [{ kind: "family_member", familyMemberId: "c", percent: 1 }] },
  ],
  entities: [
    { id: "e1", name: "Smith LLC", entityType: "llc", value: 100, valueGrowthRate: 0.03, owners: [{ kind: "family_member", familyMemberId: "c", percent: 1 }] },
  ],
  familyMembers: [{ id: "c", role: "client", relationship: "child", firstName: "John", lastName: null, dateOfBirth: null }],
  notesReceivable: [{ id: "n1", name: "Note", owners: [{ kind: "family_member", familyMemberId: "c", percent: 1 }] }],
} as unknown as ClientData;

describe("buildViewModelInputs", () => {
  const out = buildViewModelInputs(tree);

  it("maps accounts to AccountLike (id, name, category, owners, business-as-asset fields)", () => {
    expect(out.accounts).toEqual([
      { id: "a1", name: "Checking", category: "cash", owners: tree.accounts[0].owners, parentAccountId: null, businessType: null },
    ]);
  });

  it("maps liabilities to LiabilityLike with linkedPropertyId coerced to null", () => {
    expect(out.liabilities[0]).toEqual({ id: "l1", name: "Mortgage", owners: tree.liabilities[0].owners, linkedPropertyId: "h1", parentAccountId: null });
  });

  it("maps entities to EntityInfo carrying entityType/value/valueGrowthRate/owners", () => {
    expect(out.entities[0]).toMatchObject({ id: "e1", name: "Smith LLC", entityType: "llc", value: 100, valueGrowthRate: 0.03 });
  });

  it("passes through familyMembers and notesReceivable", () => {
    expect(out.familyMembers).toBe(tree.familyMembers);
    expect(out.notesReceivable[0]).toEqual({ id: "n1", name: "Note", owners: tree.notesReceivable![0].owners });
  });

  it("tolerates missing optional arrays", () => {
    const empty = buildViewModelInputs({} as ClientData);
    expect(empty.accounts).toEqual([]);
    expect(empty.entities).toEqual([]);
    expect(empty.notesReceivable).toEqual([]);
    expect(empty.familyMembers).toEqual([]);
  });

  it("includes merged synthetic accounts as AccountLike rows", () => {
    const synthetic = [{ id: "equity-dest-plan1", name: "TSLA shares", category: "taxable", owners: [] }];
    const enriched = { ...tree, accounts: [...(tree.accounts ?? []), ...synthetic] } as unknown as ClientData;
    const out = buildViewModelInputs(enriched);
    expect(out.accounts.find((a) => a.id === "equity-dest-plan1")).toMatchObject({
      id: "equity-dest-plan1", name: "TSLA shares", category: "taxable",
    });
  });
});
