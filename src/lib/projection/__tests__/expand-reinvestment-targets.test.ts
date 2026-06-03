import { describe, it, expect } from "vitest";
import { expandReinvestmentTargets } from "../expand-reinvestment-targets";
import type { AccountCategory } from "@/lib/account-groups/liquid-filter";

const accountCategoryById = new Map<string, AccountCategory>([
  ["tax1", "taxable"],
  ["cash1", "cash"],
  ["ret1", "retirement"],
  ["re1", "real_estate"], // illiquid — never selected by default keys
]);

describe("expandReinvestmentTargets", () => {
  it("returns individual accounts unchanged when no groups", () => {
    const out = expandReinvestmentTargets(["tax1"], [], {
      accountCategoryById,
      customGroupMembersById: new Map(),
    });
    expect(out.sort()).toEqual(["tax1"]);
  });

  it("expands the all-liquid default key to every liquid account", () => {
    const out = expandReinvestmentTargets([], ["all-liquid"], {
      accountCategoryById,
      customGroupMembersById: new Map(),
    });
    expect(out.sort()).toEqual(["cash1", "ret1", "tax1"]);
  });

  it("expands a category default key to that category only", () => {
    const out = expandReinvestmentTargets([], ["taxable"], {
      accountCategoryById,
      customGroupMembersById: new Map(),
    });
    expect(out).toEqual(["tax1"]);
  });

  it("expands a custom group UUID to its (liquid) members", () => {
    const out = expandReinvestmentTargets([], ["grp-uuid"], {
      accountCategoryById,
      customGroupMembersById: new Map([["grp-uuid", ["cash1", "ret1"]]]),
    });
    expect(out.sort()).toEqual(["cash1", "ret1"]);
  });

  it("dedupes the union of individual + group selections", () => {
    const out = expandReinvestmentTargets(["tax1"], ["taxable", "cash"], {
      accountCategoryById,
      customGroupMembersById: new Map(),
    });
    expect(out.sort()).toEqual(["cash1", "tax1"]);
  });

  it("ignores an unknown custom group key (no members)", () => {
    const out = expandReinvestmentTargets(["tax1"], ["missing-uuid"], {
      accountCategoryById,
      customGroupMembersById: new Map(),
    });
    expect(out).toEqual(["tax1"]);
  });
});
