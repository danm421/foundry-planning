import { describe, it, expect } from "vitest";
import { resolveAccountOwner } from "../resolve-owner";

describe("resolveAccountOwner", () => {
  it("returns entity when ownerEntityId is set (highest precedence)", () => {
    expect(
      resolveAccountOwner({
        owner: "client",
        ownerEntityId: "ent-1",
        ownerFamilyMemberId: "fm-1",
      }),
    ).toEqual({ kind: "entity", id: "ent-1" });
  });

  it("returns family_member when entity is null and family member is set", () => {
    expect(
      resolveAccountOwner({
        owner: "spouse",
        ownerEntityId: null,
        ownerFamilyMemberId: "fm-1",
      }),
    ).toEqual({ kind: "family_member", id: "fm-1" });
  });

  it("falls back to individual when no overrides set", () => {
    expect(
      resolveAccountOwner({
        owner: "joint",
        ownerEntityId: null,
        ownerFamilyMemberId: null,
      }),
    ).toEqual({ kind: "individual", who: "joint" });
  });
});
