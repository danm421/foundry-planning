import { describe, it, expect } from "vitest";
import { applyGrantorSuccession } from "../grantor-succession";
import type { EntitySummary } from "../../types";

function entity(overrides: Partial<EntitySummary>): EntitySummary {
  return {
    id: "e1",
    includeInPortfolio: true,
    isGrantor: false,
    ...overrides,
  };
}

describe("applyGrantorSuccession", () => {
  it("skips entities the decedent wasn't a grantor of", () => {
    const entities = [
      entity({ id: "spouse-trust", grantor: "spouse", isGrantor: true }),
      entity({ id: "third-party-trust", grantor: undefined, isIrrevocable: true }),
    ];
    const r = applyGrantorSuccession({ deceased: "client", entities });
    expect(r.entityUpdates).toEqual([]);
    expect(r.pourOutQueue).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("revocable + client-grantor + client dies → flip both flags + pour-out", () => {
    const e = entity({
      id: "rev-trust",
      grantor: "client",
      isGrantor: true,
      isIrrevocable: false,
      beneficiaries: [
        { id: "b1", tier: "primary", percentage: 100, familyMemberId: "child-1", sortOrder: 0 },
      ],
    });
    const r = applyGrantorSuccession({ deceased: "client", entities: [e] });

    expect(r.entityUpdates).toEqual([
      { entityId: "rev-trust", isGrantor: false, isIrrevocable: true, grantor: null },
    ]);
    expect(r.pourOutQueue).toEqual([
      { entityId: "rev-trust", trustBeneficiaries: e.beneficiaries },
    ]);
    expect(r.warnings).toEqual([]);
    expect(e.isGrantor).toBe(true);
    expect(e.isIrrevocable).toBe(false);
    expect(e.grantor).toBe("client");
  });

  it("IDGT (irrevocable + grantor + client-grantor) + client dies → flip isGrantor only, no pour-out, warning", () => {
    const e = entity({
      id: "idgt",
      grantor: "client",
      isGrantor: true,
      isIrrevocable: true,
    });
    const r = applyGrantorSuccession({ deceased: "client", entities: [e] });

    expect(r.entityUpdates).toEqual([
      { entityId: "idgt", isGrantor: false, grantor: null },
    ]);
    expect(r.pourOutQueue).toEqual([]);
    expect(r.warnings).toEqual(["idgt_grantor_flipped: idgt"]);
  });

  it("revocable + spouse-grantor + client dies → skipped", () => {
    const e = entity({
      id: "spouse-rev-trust",
      grantor: "spouse",
      isGrantor: true,
      isIrrevocable: false,
    });
    const r = applyGrantorSuccession({ deceased: "client", entities: [e] });
    expect(r.entityUpdates).toEqual([]);
    expect(r.pourOutQueue).toEqual([]);
  });

  it("irrevocable but NOT a grantor trust (pure irrevocable where isGrantor=false) + client dies → skipped", () => {
    const e = entity({
      id: "ilit",
      grantor: "client",
      isGrantor: false,
      isIrrevocable: true,
    });
    const r = applyGrantorSuccession({ deceased: "client", entities: [e] });
    expect(r.entityUpdates).toEqual([]);
    expect(r.pourOutQueue).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("returns pour-out queue with empty beneficiaries when trust had none", () => {
    const e = entity({
      id: "rev-trust",
      grantor: "client",
      isGrantor: true,
      isIrrevocable: false,
      beneficiaries: undefined,
    });
    const r = applyGrantorSuccession({ deceased: "client", entities: [e] });
    expect(r.pourOutQueue[0].trustBeneficiaries).toEqual([]);
  });
});
