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
