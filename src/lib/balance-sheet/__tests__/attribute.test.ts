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

describe("attributeToColumns — placeholder", () => {
  it("returns zeros from the stub", () => {
    const result = attributeToColumns(
      item("a1", 100, []),
      baseCtx(),
    );
    expect(result).toEqual({ cooper: 0, sarah: 0, joint: 0, ooe: 0, representedPct: 1 });
  });
});

describe("attributeEntityFlatValue — placeholder", () => {
  it("returns zeros from the stub", () => {
    const result = attributeEntityFlatValue(
      { id: "e1", value: 100, owners: [] },
      baseCtx(),
    );
    expect(result).toEqual({ cooper: 0, sarah: 0, joint: 0, ooe: 0, representedPct: 1 });
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
