import { describe, it, expect } from "vitest";
import { ownerSelectValue, ownersFromSelectValue } from "../owner-presets";
import type { AccountOwner } from "@/engine/ownership";

const C = "fm-client";
const S = "fm-spouse";

const sole = (id: string): AccountOwner[] => [
  { kind: "family_member", familyMemberId: id, percent: 1 },
];
const fiftyFifty: AccountOwner[] = [
  { kind: "family_member", familyMemberId: C, percent: 0.5 },
  { kind: "family_member", familyMemberId: S, percent: 0.5 },
];

describe("ownerSelectValue", () => {
  it("recognises sole client and sole spouse", () => {
    expect(ownerSelectValue(sole(C), C, S, "jtwros")).toBe("client");
    expect(ownerSelectValue(sole(S), C, S, "jtwros")).toBe("spouse");
  });

  it("distinguishes joint from community property by titlingType alone", () => {
    // Identical owners arrays. This is exactly why titlingType must travel
    // with owners in every write — see the plan's Global Constraints.
    expect(ownerSelectValue(fiftyFifty, C, S, "jtwros")).toBe("joint");
    expect(ownerSelectValue(fiftyFifty, C, S, "community_property"))
      .toBe("community_property");
  });

  it("recognises a 100% entity owner as a preset", () => {
    const owners: AccountOwner[] = [{ kind: "entity", entityId: "e1", percent: 1 }];
    expect(ownerSelectValue(owners, C, S, "jtwros")).toBe("ent:e1");
  });

  it("recognises a 100% non-principal family member as a preset", () => {
    expect(ownerSelectValue(sole("fm-kid"), C, S, "jtwros")).toBe("fm:fm-kid");
  });

  it("returns null for a real percentage split — the cell must go read-only", () => {
    const split: AccountOwner[] = [
      { kind: "family_member", familyMemberId: C, percent: 0.7 },
      { kind: "family_member", familyMemberId: S, percent: 0.3 },
    ];
    expect(ownerSelectValue(split, C, S, "jtwros")).toBeNull();
  });

  it("returns null for gifted-away and external-beneficiary owners", () => {
    const gifted: AccountOwner[] = [
      { kind: "gifted_away", recipient: { kind: "family_member", id: "fm-kid" }, percent: 1 },
    ];
    expect(ownerSelectValue(gifted, C, S, "jtwros")).toBeNull();
  });

  it("returns null for an empty owners array", () => {
    expect(ownerSelectValue([], C, S, "jtwros")).toBeNull();
  });
});

describe("ownersFromSelectValue", () => {
  it("builds a sole-client array", () => {
    expect(ownersFromSelectValue("client", C, S)).toEqual({
      owners: sole(C),
      titlingType: "jtwros",
    });
  });

  it("builds joint in client-then-spouse order so deriveMode round-trips it", () => {
    const built = ownersFromSelectValue("joint", C, S)!;
    expect(built.owners).toEqual(fiftyFifty);
    expect(built.titlingType).toBe("jtwros");
    expect(ownerSelectValue(built.owners, C, S, built.titlingType)).toBe("joint");
  });

  it("builds community property with the same owners but the other titling", () => {
    const built = ownersFromSelectValue("community_property", C, S)!;
    expect(built.owners).toEqual(fiftyFifty);
    expect(built.titlingType).toBe("community_property");
    expect(ownerSelectValue(built.owners, C, S, built.titlingType))
      .toBe("community_property");
  });

  it("builds a 100% entity owner", () => {
    expect(ownersFromSelectValue("ent:e1", C, S)).toEqual({
      owners: [{ kind: "entity", entityId: "e1", percent: 1 }],
      titlingType: "jtwros",
    });
  });

  it("returns null for joint when there is no spouse", () => {
    expect(ownersFromSelectValue("joint", C, undefined)).toBeNull();
  });

  it("returns null for an unrecognised value", () => {
    expect(ownersFromSelectValue("nonsense", C, S)).toBeNull();
  });
});
