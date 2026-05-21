import { describe, it, expect } from "vitest";
import { applyEntityOwnersOp, EPSILON } from "../entity-owners-ops";
import type { EntityOwner } from "@/engine/ownership";

const TRUST_ID = "trust-1";

function sum(owners: EntityOwner[]): number {
  return owners.reduce((s, o) => s + o.percent, 0);
}

function trustPct(owners: EntityOwner[], trustId = TRUST_ID): number {
  const row = owners.find(
    (o) => o.kind === "entity" && o.entityId === trustId,
  );
  return row ? row.percent : 0;
}

function fmPct(owners: EntityOwner[], fmId: string): number {
  const row = owners.find(
    (o) => o.kind === "family_member" && o.familyMemberId === fmId,
  );
  return row ? row.percent : 0;
}

describe("applyEntityOwnersOp — add", () => {
  it("adds 100% trust ownership to a business solely owned by client", () => {
    const owners: EntityOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 1.0 },
    ];
    const result = applyEntityOwnersOp(owners, {
      type: "add",
      trustId: TRUST_ID,
      percent: 1.0,
    });

    expect(trustPct(result.newOwners)).toBeCloseTo(1.0, 4);
    expect(fmPct(result.newOwners, "fm-c")).toBeCloseTo(0, 4);
    expect(Math.abs(sum(result.newOwners) - 1)).toBeLessThan(EPSILON);
    expect(result.familyLosses).toEqual([
      { familyMemberId: "fm-c", lost: expect.any(Number) },
    ]);
    expect(result.familyLosses[0].lost).toBeCloseTo(1.0, 4);
    expect(result.appliedDebit).toBeCloseTo(1.0, 4);
  });

  it("adds 50% trust ownership to a business solely owned by client", () => {
    const owners: EntityOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 1.0 },
    ];
    const result = applyEntityOwnersOp(owners, {
      type: "add",
      trustId: TRUST_ID,
      percent: 0.5,
    });

    expect(trustPct(result.newOwners)).toBeCloseTo(0.5, 4);
    expect(fmPct(result.newOwners, "fm-c")).toBeCloseTo(0.5, 4);
    expect(result.familyLosses[0].lost).toBeCloseTo(0.5, 4);
    expect(result.appliedDebit).toBeCloseTo(0.5, 4);
  });

  it("adds 100% trust ownership to a business owned 50/50 by client+spouse — each loses 50%", () => {
    const owners: EntityOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-s", percent: 0.5 },
    ];
    const result = applyEntityOwnersOp(owners, {
      type: "add",
      trustId: TRUST_ID,
      percent: 1.0,
    });

    expect(trustPct(result.newOwners)).toBeCloseTo(1.0, 4);
    expect(fmPct(result.newOwners, "fm-c")).toBeCloseTo(0, 4);
    expect(fmPct(result.newOwners, "fm-s")).toBeCloseTo(0, 4);

    // Should produce two losses, each 0.5
    expect(result.familyLosses).toHaveLength(2);
    const clientLoss = result.familyLosses.find((l) => l.familyMemberId === "fm-c");
    const spouseLoss = result.familyLosses.find((l) => l.familyMemberId === "fm-s");
    expect(clientLoss?.lost).toBeCloseTo(0.5, 4);
    expect(spouseLoss?.lost).toBeCloseTo(0.5, 4);
  });

  it("adds 30% trust ownership to a 70/30 client/spouse business — each loses proportionally", () => {
    const owners: EntityOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.7 },
      { kind: "family_member", familyMemberId: "fm-s", percent: 0.3 },
    ];
    const result = applyEntityOwnersOp(owners, {
      type: "add",
      trustId: TRUST_ID,
      percent: 0.3,
    });

    expect(trustPct(result.newOwners)).toBeCloseTo(0.3, 4);
    // Client: 0.7 * (1.0 - 0.3) / 1.0 = 0.49
    expect(fmPct(result.newOwners, "fm-c")).toBeCloseTo(0.49, 4);
    // Spouse: 0.3 * (1.0 - 0.3) / 1.0 = 0.21
    expect(fmPct(result.newOwners, "fm-s")).toBeCloseTo(0.21, 4);

    expect(result.familyLosses).toHaveLength(2);
    const clientLoss = result.familyLosses.find((l) => l.familyMemberId === "fm-c");
    const spouseLoss = result.familyLosses.find((l) => l.familyMemberId === "fm-s");
    expect(clientLoss?.lost).toBeCloseTo(0.21, 4);
    expect(spouseLoss?.lost).toBeCloseTo(0.09, 4);
  });

  it("combines trust shares when the trust already owns part of the business", () => {
    const owners: EntityOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.8 },
      { kind: "entity", entityId: TRUST_ID, percent: 0.2 },
    ];
    const result = applyEntityOwnersOp(owners, {
      type: "add",
      trustId: TRUST_ID,
      percent: 0.3,
    });

    expect(trustPct(result.newOwners)).toBeCloseTo(0.5, 4);
    expect(fmPct(result.newOwners, "fm-c")).toBeCloseTo(0.5, 4);
    // The family-member loss is the change from 0.8 to 0.5 = 0.3.
    expect(result.familyLosses[0].familyMemberId).toBe("fm-c");
    expect(result.familyLosses[0].lost).toBeCloseTo(0.3, 4);
    expect(result.appliedDebit).toBeCloseTo(0.3, 4);
  });

  it("caps debit when requested percent exceeds available family share", () => {
    const owners: EntityOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
      // Other 0.5 is held by some other entity row.
      { kind: "entity", entityId: "other-entity", percent: 0.5 },
    ];
    const result = applyEntityOwnersOp(owners, {
      type: "add",
      trustId: TRUST_ID,
      percent: 1.0,
    });

    // Trust can only absorb up to othersSum = 1.0 → trust ends up at 1.0,
    // both other rows at 0. Verify sum still ≤ 1.0.
    expect(Math.abs(sum(result.newOwners) - 1)).toBeLessThan(EPSILON);
    expect(result.appliedDebit).toBeCloseTo(1.0, 4);
    expect(trustPct(result.newOwners)).toBeCloseTo(1.0, 4);
    // The family member's loss is just their old percent (0.5) — only family
    // losses produce gifts.
    const clientLoss = result.familyLosses.find((l) => l.familyMemberId === "fm-c");
    expect(clientLoss?.lost).toBeCloseTo(0.5, 4);
  });

  it("returns no-op when adding 0%", () => {
    const owners: EntityOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 1.0 },
    ];
    const result = applyEntityOwnersOp(owners, {
      type: "add",
      trustId: TRUST_ID,
      percent: 0,
    });
    expect(result.appliedDebit).toBe(0);
    expect(result.familyLosses).toHaveLength(0);
  });

  it("returns no-op (appliedDebit=0) when there is no family/other share to take", () => {
    const owners: EntityOwner[] = []; // no existing owners — nothing to debit
    const result = applyEntityOwnersOp(owners, {
      type: "add",
      trustId: TRUST_ID,
      percent: 0.5,
    });
    expect(result.appliedDebit).toBe(0);
    expect(result.familyLosses).toHaveLength(0);
  });
});

describe("applyEntityOwnersOp — set-percent", () => {
  it("grows trust share and shrinks others proportionally", () => {
    const owners: EntityOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
      { kind: "family_member", familyMemberId: "fm-s", percent: 0.4 },
    ];
    const result = applyEntityOwnersOp(owners, {
      type: "set-percent",
      trustId: TRUST_ID,
      percent: 0.5,
    });
    expect(trustPct(result.newOwners)).toBeCloseTo(0.5, 4);
    expect(fmPct(result.newOwners, "fm-c")).toBeCloseTo(0.3, 4);
    expect(fmPct(result.newOwners, "fm-s")).toBeCloseTo(0.2, 4);
    expect(Math.abs(sum(result.newOwners) - 1)).toBeLessThan(EPSILON);
    expect(result.familyLosses).toHaveLength(2);
  });
});
