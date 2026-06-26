// src/lib/balance-sheet/__tests__/attribute.test.ts
import { describe, expect, it } from "vitest";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import {
  attributeToColumns,
  attributeEntityFlatValue,
  type AttributionCtx,
  type AttributableItem,
} from "../attribute";

const CLIENT_FM = "fm-client";
const SPOUSE_FM = "fm-spouse";
const CHILD_FM = "fm-child";
const COOPER_LLC = "ent-cooper-llc";
const DYNASTY_TRUST = "ent-dynasty";

function baseCtx(overrides: Partial<AttributionCtx> = {}): AttributionCtx {
  return {
    clientFamilyMemberId: CLIENT_FM,
    spouseFamilyMemberId: SPOUSE_FM,
    rolesByFamilyMemberId: new Map<string, "client" | "spouse" | "child" | "other">([
      [CLIENT_FM, "client"],
      [SPOUSE_FM, "spouse"],
      [CHILD_FM, "child"],
    ]),
    inEstateFlatValuedEntityIds: new Set([COOPER_LLC]),
    titlingByItemId: new Map(),
    ...overrides,
  };
}

function item(
  id: string,
  value: number,
  owners: AttributableItem["owners"],
): AttributableItem {
  return { id, value, owners };
}

describe("ownerless items are household-owned by convention", () => {
  // A row with no account_owners (e.g. a Plaid "Add as new" account/debt, which
  // the commit route inserts without an owner row) is household-owned. Mirror
  // normalizeOwners + attributeEntityFlatValue: attribute the whole value to the
  // client column rather than dropping it.
  it("empty owners → whole value to the client (Cooper) column", () => {
    const result = attributeToColumns(
      item("a1", 100, []),
      baseCtx(),
    );
    expect(result).toEqual({ cooper: 100, sarah: 0, joint: 0, ooe: 0, representedPct: 1 });
  });
});


describe("rule 1: direct family-member ownership", () => {
  it("client 100% → Cooper column", () => {
    const r = attributeToColumns(
      item("a", 250_000, [{ kind: "family_member", familyMemberId: CLIENT_FM, percent: 1 }]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 250_000, sarah: 0, joint: 0, ooe: 0, representedPct: 1 });
  });

  it("spouse 100% → Sarah column", () => {
    const r = attributeToColumns(
      item("a", 80_000, [{ kind: "family_member", familyMemberId: SPOUSE_FM, percent: 1 }]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 0, sarah: 80_000, joint: 0, ooe: 0, representedPct: 1 });
  });

  it("client 70% + spouse 30% (no joint titling) → split proportionally", () => {
    const r = attributeToColumns(
      item("a", 500_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.7 },
        { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.3 },
      ]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 350_000, sarah: 150_000, joint: 0, ooe: 0, representedPct: 1 });
  });

  it("client 80% + child 20% → 80 Cooper / 20 OOE", () => {
    const r = attributeToColumns(
      item("a", 100_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.8 },
        { kind: "family_member", familyMemberId: CHILD_FM, percent: 0.2 },
      ]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 80_000, sarah: 0, joint: 0, ooe: 20_000, representedPct: 1 });
  });

  it("legacy LEGACY_FM_CLIENT / LEGACY_FM_SPOUSE ids map to client / spouse", () => {
    const r = attributeToColumns(
      item("a", 200_000, [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ]),
      baseCtx(),
    );
    // No joint titling on the item → proportional split, not Joint column.
    expect(r).toEqual({ cooper: 100_000, sarah: 100_000, joint: 0, ooe: 0, representedPct: 1 });
  });

  it("unknown family-member id (no role) treated as other → OOE", () => {
    const r = attributeToColumns(
      item("a", 100_000, [{ kind: "family_member", familyMemberId: "fm-unknown", percent: 1 }]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 0, sarah: 0, joint: 0, ooe: 100_000, representedPct: 1 });
  });
});

describe("rule 2: joint titling", () => {
  it("client+spouse 50/50 with jtwros → whole value to Joint column", () => {
    const ctx = baseCtx({
      titlingByItemId: new Map([["a", "jtwros"]]),
    });
    const r = attributeToColumns(
      item("a", 1_000_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.5 },
        { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.5 },
      ]),
      ctx,
    );
    expect(r).toEqual({ cooper: 0, sarah: 0, joint: 1_000_000, ooe: 0, representedPct: 1 });
  });

  it("client+spouse 50/50 with community_property → whole value to Joint column", () => {
    const ctx = baseCtx({
      titlingByItemId: new Map([["a", "community_property"]]),
    });
    const r = attributeToColumns(
      item("a", 1_000_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.5 },
        { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.5 },
      ]),
      ctx,
    );
    expect(r.joint).toBe(1_000_000);
  });

  it("client+spouse 50/50 with NO titling → proportional split, not Joint", () => {
    const r = attributeToColumns(
      item("a", 1_000_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.5 },
        { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.5 },
      ]),
      baseCtx(), // titlingByItemId is empty
    );
    expect(r).toEqual({ cooper: 500_000, sarah: 500_000, joint: 0, ooe: 0, representedPct: 1 });
  });

  it("client+spouse 60/40 with jtwros titling → NOT joint (split proportionally)", () => {
    const ctx = baseCtx({
      titlingByItemId: new Map([["a", "jtwros"]]),
    });
    const r = attributeToColumns(
      item("a", 1_000_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.6 },
        { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.4 },
      ]),
      ctx,
    );
    expect(r).toEqual({ cooper: 600_000, sarah: 400_000, joint: 0, ooe: 0, representedPct: 1 });
  });

  it("joint titling with extra non-spouse owner → NOT joint", () => {
    const ctx = baseCtx({
      titlingByItemId: new Map([["a", "jtwros"]]),
    });
    const r = attributeToColumns(
      item("a", 1_000_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.45 },
        { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.45 },
        { kind: "family_member", familyMemberId: CHILD_FM, percent: 0.1 },
      ]),
      ctx,
    );
    // Not the 2-owner-50/50 pattern; falls back to rule 1.
    expect(r.joint).toBe(0);
    expect(r.cooper).toBeCloseTo(450_000);
    expect(r.sarah).toBeCloseTo(450_000);
    expect(r.ooe).toBeCloseTo(100_000);
  });
});

describe("rule 3: in-estate flat-valued entity held back from row", () => {
  it("client 80% + in-estate LLC 20% → Cooper $80k, no OOE, representedPct=0.8", () => {
    const r = attributeToColumns(
      item("a", 100_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.8 },
        { kind: "entity", entityId: COOPER_LLC, percent: 0.2 },
      ]),
      baseCtx(),
    );
    expect(r.cooper).toBe(80_000);
    expect(r.sarah).toBe(0);
    expect(r.joint).toBe(0);
    expect(r.ooe).toBe(0);
    expect(r.representedPct).toBeCloseTo(0.8);
  });

  it("in-estate LLC 100% → row contributes nothing, representedPct=0", () => {
    const r = attributeToColumns(
      item("a", 50_000, [{ kind: "entity", entityId: COOPER_LLC, percent: 1 }]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 0, sarah: 0, joint: 0, ooe: 0, representedPct: 0 });
  });
});

describe("rule 4: OOE entity ownership → OOE column", () => {
  it("Dynasty Trust 100% → OOE $300k", () => {
    const r = attributeToColumns(
      item("a", 300_000, [{ kind: "entity", entityId: DYNASTY_TRUST, percent: 1 }]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 0, sarah: 0, joint: 0, ooe: 300_000, representedPct: 1 });
  });

  it("client 80% + OOE Dynasty Trust 20% → Cooper $80k, OOE $20k", () => {
    const r = attributeToColumns(
      item("a", 100_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.8 },
        { kind: "entity", entityId: DYNASTY_TRUST, percent: 0.2 },
      ]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 80_000, sarah: 0, joint: 0, ooe: 20_000, representedPct: 1 });
  });
});

describe("rule 5: external beneficiaries → OOE column", () => {
  it("client 60% + external beneficiary 40% → Cooper $60k, OOE $40k", () => {
    const r = attributeToColumns(
      item("a", 100_000, [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.6 },
        { kind: "external_beneficiary", externalBeneficiaryId: "ext-1", percent: 0.4 },
      ]),
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 60_000, sarah: 0, joint: 0, ooe: 40_000, representedPct: 1 });
  });
});

describe("attributeEntityFlatValue — in-estate business rows", () => {
  it("100% client → Cooper column", () => {
    const r = attributeEntityFlatValue(
      { id: "e1", value: 800_000, owners: [{ familyMemberId: CLIENT_FM, percent: 1 }] },
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 800_000, sarah: 0, joint: 0, ooe: 0, representedPct: 1 });
  });

  it("50/50 client + spouse → Cooper + Sarah (no joint column for entities)", () => {
    const r = attributeEntityFlatValue(
      { id: "e1", value: 1_000_000, owners: [
        { familyMemberId: CLIENT_FM, percent: 0.5 },
        { familyMemberId: SPOUSE_FM, percent: 0.5 },
      ] },
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 500_000, sarah: 500_000, joint: 0, ooe: 0, representedPct: 1 });
  });

  it("client 80% + child 20% → Cooper $80k, OOE $20k", () => {
    const r = attributeEntityFlatValue(
      { id: "e1", value: 100_000, owners: [
        { familyMemberId: CLIENT_FM, percent: 0.8 },
        { familyMemberId: CHILD_FM, percent: 0.2 },
      ] },
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 80_000, sarah: 0, joint: 0, ooe: 20_000, representedPct: 1 });
  });

  it("owners=undefined (legacy: assume 100% client) → Cooper column", () => {
    const r = attributeEntityFlatValue(
      { id: "e1", value: 500_000, owners: undefined },
      baseCtx(),
    );
    expect(r).toEqual({ cooper: 500_000, sarah: 0, joint: 0, ooe: 0, representedPct: 1 });
  });
});
