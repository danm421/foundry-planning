import { describe, it, expect } from "vitest";
import { ownersForYear, liabilityOwnersForYear } from "../ownership";
import type { GiftEvent } from "../types";

const ACC = { id: "acc-1", owners: [
  { kind: "family_member" as const, familyMemberId: "fm-c", percent: 0.6 },
  { kind: "family_member" as const, familyMemberId: "fm-s", percent: 0.4 },
]};
const LIAB = { id: "liab-1", owners: [
  { kind: "family_member" as const, familyMemberId: "fm-c", percent: 0.6 },
  { kind: "family_member" as const, familyMemberId: "fm-s", percent: 0.4 },
]};

describe("composer parity — the two resolvers agree on every shared rule", () => {
  it("shrinks household rows proportionally and adds the entity row", () => {
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    const gl: GiftEvent[] = [{ kind: "liability", year: 2027, liabilityId: "liab-1",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1", parentGiftId: "p1" }];
    const a = ownersForYear(ACC, g, 2027, 2026);
    const l = liabilityOwnersForYear(LIAB, gl, 2027, 2026);
    // Parity between the two resolvers is what this case exists to prove — exact.
    expect(a).toEqual(l);
    // Magnitudes with tolerance: 0.4 * 0.8 is 0.32000000000000006 in IEEE-754,
    // so a decimal literal would pin the float representation, not the rule.
    expect(a.map((o) => o.kind)).toEqual(["family_member", "family_member", "entity"]);
    expect((a[0] as { familyMemberId: string }).familyMemberId).toBe("fm-c");
    expect((a[1] as { familyMemberId: string }).familyMemberId).toBe("fm-s");
    expect((a[2] as { entityId: string }).entityId).toBe("trust-1");
    expect(a[0].percent).toBeCloseTo(0.48, 12);
    expect(a[1].percent).toBeCloseTo(0.32, 12);
    expect(a[2].percent).toBeCloseTo(0.2, 12);
  });

  it("ignores events dated before projectionStartYear (already in the baseline)", () => {
    const g: GiftEvent[] = [{ kind: "asset", year: 2025, accountId: "acc-1",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    expect(ownersForYear(ACC, g, 2030, 2026)).toEqual(ACC.owners);
  });

  it("ignores events dated after the requested year", () => {
    const g: GiftEvent[] = [{ kind: "asset", year: 2031, accountId: "acc-1",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    expect(ownersForYear(ACC, g, 2030, 2026)).toEqual(ACC.owners);
  });

  it("merges two gifts to the SAME recipient in the SAME year, in either order", () => {
    // Review Focus #4: series fan-out emits same-year pairs; the merge must be
    // commutative, because the sort is by year only and leaves array order.
    const mk = (p: number): GiftEvent => ({ kind: "asset", year: 2027,
      accountId: "acc-1", percent: p, grantor: "client", recipientEntityId: "trust-1" });
    const forward = ownersForYear(ACC, [mk(0.1), mk(0.2)], 2027, 2026);
    const reverse = ownersForYear(ACC, [mk(0.2), mk(0.1)], 2027, 2026);
    // Commutative to within floating-point noise: the two orders differ by ~1 ULP,
    // so bit-exact toEqual would be testing IEEE-754 rather than the merge rule.
    expect(forward.map((o) => o.kind)).toEqual(reverse.map((o) => o.kind));
    forward.forEach((o, i) => expect(o.percent).toBeCloseTo(reverse[i].percent, 12));
    const trust = forward.find((o) => o.kind === "entity");
    expect(trust?.percent).toBeCloseTo(0.3, 9);
  });

  it("merges two gifts to the same PERSON into one gifted_away row", () => {
    const mk = (p: number): GiftEvent => ({ kind: "asset", year: 2027,
      accountId: "acc-1", percent: p, grantor: "client", recipientFamilyMemberId: "fm-kid" });
    const out = ownersForYear(ACC, [mk(0.1), mk(0.2)], 2027, 2026);
    const away = out.filter((o) => o.kind === "gifted_away");
    expect(away).toHaveLength(1);
    expect(away[0].percent).toBeCloseTo(0.3, 9);
  });

  it("throws with the caller's own noun on overdraw", () => {
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 1.5, grantor: "client", recipientEntityId: "trust-1" }];
    expect(() => ownersForYear(ACC, g, 2027, 2026)).toThrow(/ownersForYear.*account acc-1/);
    const gl: GiftEvent[] = [{ kind: "liability", year: 2027, liabilityId: "liab-1",
      percent: 1.5, grantor: "client", recipientEntityId: "trust-1", parentGiftId: "p1" }];
    expect(() => liabilityOwnersForYear(LIAB, gl, 2027, 2026))
      .toThrow(/liabilityOwnersForYear.*liability liab-1/);
  });

  it("throws when the household share is already fully drained", () => {
    // Review Focus #2: a 100% gift leaves no household share; the NEXT gift
    // divides by zero without this guard.
    const g: GiftEvent[] = [
      { kind: "asset", year: 2027, accountId: "acc-1", percent: 1,
        grantor: "client", recipientEntityId: "trust-1" },
      { kind: "asset", year: 2028, accountId: "acc-1", percent: 0.1,
        grantor: "client", recipientEntityId: "trust-2" },
    ];
    expect(() => ownersForYear(ACC, g, 2028, 2026))
      .toThrow(/no household share remaining/);
  });
});
