import { describe, it, expect } from "vitest";
import { matchOwnersFromHint, type OwnerMatchFamilyMember } from "../owner-match";

const fam: OwnerMatchFamilyMember[] = [
  { id: "c", role: "client", firstName: "John", lastName: "Smith" },
  { id: "s", role: "spouse", firstName: "Jane", lastName: "Smith" },
];

describe("matchOwnersFromHint", () => {
  it("matches a single client by first name", () => {
    expect(matchOwnersFromHint("John A. Smith", undefined, fam)).toEqual([
      { kind: "family_member", familyMemberId: "c", percent: 1 },
    ]);
  });

  it("makes a 50/50 joint when both names appear", () => {
    expect(matchOwnersFromHint("John & Jane Smith", undefined, fam)).toEqual([
      { kind: "family_member", familyMemberId: "c", percent: 0.5 },
      { kind: "family_member", familyMemberId: "s", percent: 0.5 },
    ]);
  });

  it("makes joint on a JTWROS cue even when only the surname matches", () => {
    expect(matchOwnersFromHint("Smith Family JTWROS", "joint", fam)).toEqual([
      { kind: "family_member", familyMemberId: "c", percent: 0.5 },
      { kind: "family_member", familyMemberId: "s", percent: 0.5 },
    ]);
  });

  it("tolerates a one-character typo in the first name", () => {
    expect(matchOwnersFromHint("Jon Smith", undefined, fam)).toEqual([
      { kind: "family_member", familyMemberId: "c", percent: 1 },
    ]);
  });

  it("falls back to the coarse owner enum when nothing matches", () => {
    expect(matchOwnersFromHint("Acme Holdings Trust", "spouse", fam)).toEqual([
      { kind: "family_member", familyMemberId: "s", percent: 1 },
    ]);
  });

  it("uses the coarse enum when there is no hint", () => {
    expect(matchOwnersFromHint(undefined, "joint", fam)).toEqual([
      { kind: "family_member", familyMemberId: "c", percent: 0.5 },
      { kind: "family_member", familyMemberId: "s", percent: 0.5 },
    ]);
  });

  it("returns [] when the client family member is missing and no match", () => {
    expect(matchOwnersFromHint("Nobody", undefined, [])).toEqual([]);
  });
});
