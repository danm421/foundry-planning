import { describe, it, expect } from "vitest";
import { deriveLegacyOwnership } from "../derive-ownership";
import type { FamilyMember } from "@/engine/types";

const roleById = new Map<string, FamilyMember["role"]>([
  ["fm-client", "client"],
  ["fm-spouse", "spouse"],
  ["fm-child", "child"],
]);

describe("deriveLegacyOwnership", () => {
  it("maps single-client family member → client", () => {
    expect(
      deriveLegacyOwnership(
        [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        roleById,
      ),
    ).toEqual({ owner: "client", ownerEntityId: null });
  });

  it("maps single-spouse family member → spouse", () => {
    expect(
      deriveLegacyOwnership(
        [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }],
        roleById,
      ),
    ).toEqual({ owner: "spouse", ownerEntityId: null });
  });

  it("maps client + spouse 50/50 → joint", () => {
    expect(
      deriveLegacyOwnership(
        [
          { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
          { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
        ],
        roleById,
      ),
    ).toEqual({ owner: "joint", ownerEntityId: null });
  });

  it("maps client + spouse fractional non-50/50 → joint", () => {
    expect(
      deriveLegacyOwnership(
        [
          { kind: "family_member", familyMemberId: "fm-client", percent: 0.7 },
          { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.3 },
        ],
        roleById,
      ),
    ).toEqual({ owner: "joint", ownerEntityId: null });
  });

  it("maps single 100% entity owner → ownerEntityId set, owner null", () => {
    expect(
      deriveLegacyOwnership(
        [{ kind: "entity", entityId: "trust-1", percent: 1 }],
        roleById,
      ),
    ).toEqual({ owner: null, ownerEntityId: "trust-1" });
  });

  it("excludes child-only ownership from personal views", () => {
    expect(
      deriveLegacyOwnership(
        [{ kind: "family_member", familyMemberId: "fm-child", percent: 1 }],
        roleById,
      ),
    ).toEqual({ owner: null, ownerEntityId: null });
  });

  it("collapses client + child to client (child is ignored for the enum)", () => {
    // Post-death scenarios may leave a child as a fractional owner alongside
    // the surviving principal. Surface in the principal's view rather than
    // hiding the row entirely.
    expect(
      deriveLegacyOwnership(
        [
          { kind: "family_member", familyMemberId: "fm-client", percent: 0.6 },
          { kind: "family_member", familyMemberId: "fm-child", percent: 0.4 },
        ],
        roleById,
      ),
    ).toEqual({ owner: "client", ownerEntityId: null });
  });

  it("returns null/null when owners[] is empty", () => {
    expect(deriveLegacyOwnership([], roleById)).toEqual({
      owner: null,
      ownerEntityId: null,
    });
  });

  it("returns null/null for mixed family + entity (not representable in legacy)", () => {
    expect(
      deriveLegacyOwnership(
        [
          { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
          { kind: "entity", entityId: "trust-1", percent: 0.5 },
        ],
        roleById,
      ),
    ).toEqual({ owner: null, ownerEntityId: null });
  });

  it("returns null/null when family member id is missing from the role map", () => {
    expect(
      deriveLegacyOwnership(
        [{ kind: "family_member", familyMemberId: "fm-unknown", percent: 1 }],
        roleById,
      ),
    ).toEqual({ owner: null, ownerEntityId: null });
  });
});
