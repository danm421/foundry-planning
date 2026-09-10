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
  it("a gifted_away slice holds its own dollars and the family does not re-absorb it", () => {
    // 30% of a $1M account gifted to a child in a prior year.
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.7 },
      { kind: "gifted_away", recipient: { kind: "family_member", id: "fm-kid" }, percent: 0.3 },
    ];
    const slices = resolveOwnerSlices("acc", owners, 1_000_000);

    const client = slices.find((s) => s.owner.kind === "family_member")!;
    const away = slices.find((s) => s.owner.kind === "gifted_away")!;
    expect(client.value).toBeCloseTo(700_000, 2);
    expect(away.value).toBeCloseTo(300_000, 2);
  });

  it("scales gift-blind locked family shares onto the post-gift family pool", () => {
    // `computeFamilyAccountShares` seeds from AUTHORED owners (50/50 joint), so
    // its locked shares still describe the full $1M pre-gift pool. After a 30%
    // gift to a person the two spouses must hold $700k between them, not $1M.
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.35 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.35 },
      { kind: "gifted_away", recipient: { kind: "family_member", id: "fm-kid" }, percent: 0.3 },
    ];
    const familyLocked = new Map([
      ["fm-client", new Map([["acc", 500_000]])],
      ["fm-spouse", new Map([["acc", 500_000]])],
    ]);
    const slices = resolveOwnerSlices("acc", owners, 1_000_000, undefined, familyLocked);

    const family = slices
      .filter((s) => s.owner.kind === "family_member")
      .reduce((sum, s) => sum + s.value, 0);
    expect(family).toBeCloseTo(700_000, 2);
    expect(slices.find((s) => s.owner.kind === "gifted_away")!.value).toBeCloseTo(300_000, 2);
  });

  it("leaves locked family shares untouched when nothing was gifted away", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
    ];
    const familyLocked = new Map([
      ["fm-client", new Map([["acc", 620_000]])],
      ["fm-spouse", new Map([["acc", 380_000]])],
    ]);
    const slices = resolveOwnerSlices("acc", owners, 1_000_000, undefined, familyLocked);
    expect(slices[0].value).toBe(620_000);
    expect(slices[1].value).toBe(380_000);
  });
  it("stays consistent when an entity's locked share has drifted from its percent", () => {
    // Authored client .35 / spouse .35 / trust .30, then 30% gifted to a child:
    // `ownersForYear` shrinks the family rows to .2/.2. The trust's locked slice
    // has drifted to $400k, above the $300k its authored percent implies.
    // A percent-derived rescale would over-pay the family and break the sum.
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.2 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.2 },
      { kind: "entity", entityId: "slat", percent: 0.3 },
      { kind: "gifted_away", recipient: { kind: "family_member", id: "fm-kid" }, percent: 0.3 },
    ];
    const slices = resolveOwnerSlices(
      "acc",
      owners,
      1_000_000,
      new Map([["slat", new Map([["acc", 400_000]])]]),
      // Gift-blind family shares, seeded on the pre-gift pool of $600k.
      new Map([
        ["fm-client", new Map([["acc", 300_000]])],
        ["fm-spouse", new Map([["acc", 300_000]])],
      ]),
    );

    expect(slices.reduce((sum, s) => sum + s.value, 0)).toBeCloseTo(1_000_000, 2);
    const family = slices
      .filter((s) => s.owner.kind === "family_member")
      .reduce((sum, s) => sum + s.value, 0);
    expect(family).toBeCloseTo(300_000, 2); // 1M − 400k trust − 300k gifted
  });
});
