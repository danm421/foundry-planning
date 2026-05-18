import { describe, it, expect } from "vitest";
import { resolveOwnerSlices } from "../account-owner-slices";
import type { AccountOwner } from "@/engine/ownership";

const owners: AccountOwner[] = [
  { kind: "family_member", familyMemberId: "fm-client", percent: 0.8 },
  { kind: "entity", entityId: "biz", percent: 0.2 },
];

describe("resolveOwnerSlices", () => {
  it("values an entity slice at its locked share and gives the family the residual", () => {
    // Account drawn down to $70k by household flows; the business's locked
    // EoY share is still $20k. The family owner absorbs the drawdown.
    const slices = resolveOwnerSlices(
      "acc",
      owners,
      70_000,
      new Map([["biz", new Map([["acc", 20_000]])]]),
    );

    const entitySlice = slices.find((s) => s.owner.kind === "entity")!;
    const familySlice = slices.find((s) => s.owner.kind === "family_member")!;
    expect(entitySlice.value).toBeCloseTo(20_000, 2);
    expect(familySlice.value).toBeCloseTo(50_000, 2);
    // Slices always sum to the resolved balance.
    expect(entitySlice.value + familySlice.value).toBeCloseTo(70_000, 2);
  });

  it("falls back to authored percent × value when no locked-share data is supplied", () => {
    const slices = resolveOwnerSlices("acc", owners, 70_000);

    const entitySlice = slices.find((s) => s.owner.kind === "entity")!;
    const familySlice = slices.find((s) => s.owner.kind === "family_member")!;
    expect(entitySlice.value).toBeCloseTo(14_000, 2);
    expect(familySlice.value).toBeCloseTo(56_000, 2);
  });

  it("uses a family member's locked share directly when familyAccountSharesEoY is supplied", () => {
    // Jointly-held drift: the client's authored 80% has drifted to a locked
    // $44k EoY share. The entity still takes its locked $20k.
    const slices = resolveOwnerSlices(
      "acc",
      owners,
      70_000,
      new Map([["biz", new Map([["acc", 20_000]])]]),
      new Map([["fm-client", new Map([["acc", 44_000]])]]),
    );

    const familySlice = slices.find((s) => s.owner.kind === "family_member")!;
    expect(familySlice.value).toBeCloseTo(44_000, 2);
  });

  it("falls back to authored percent for an entity-only account (no family owners)", () => {
    const entityOnly: AccountOwner[] = [
      { kind: "entity", entityId: "biz-a", percent: 0.6 },
      { kind: "entity", entityId: "biz-b", percent: 0.4 },
    ];
    const slices = resolveOwnerSlices("acc", entityOnly, 50_000);

    expect(slices.find((s) => s.owner.kind === "entity" && s.owner.entityId === "biz-a")!.value)
      .toBeCloseTo(30_000, 2);
    expect(slices.find((s) => s.owner.kind === "entity" && s.owner.entityId === "biz-b")!.value)
      .toBeCloseTo(20_000, 2);
  });

  it("splits the family residual across multiple family owners by relative percent", () => {
    const jointOwners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.3 },
      { kind: "entity", entityId: "biz", percent: 0.2 },
    ];
    const slices = resolveOwnerSlices(
      "acc",
      jointOwners,
      70_000,
      new Map([["biz", new Map([["acc", 20_000]])]]),
    );

    // Residual $50k split 0.5 : 0.3 → $31.25k / $18.75k.
    const client = slices.find(
      (s) => s.owner.kind === "family_member" && s.owner.familyMemberId === "fm-client",
    )!;
    const spouse = slices.find(
      (s) => s.owner.kind === "family_member" && s.owner.familyMemberId === "fm-spouse",
    )!;
    expect(client.value).toBeCloseTo(31_250, 2);
    expect(spouse.value).toBeCloseTo(18_750, 2);
  });
});
