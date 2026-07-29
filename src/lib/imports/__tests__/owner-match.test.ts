import { describe, it, expect } from "vitest";
import {
  matchOwnersFromHint,
  resolveOwnersFromHint,
  type OwnerMatchFamilyMember,
} from "../owner-match";

const fam: OwnerMatchFamilyMember[] = [
  { id: "c", role: "client", firstName: "John", lastName: "Smith" },
  { id: "s", role: "spouse", firstName: "Jane", lastName: "Smith" },
];

/** A household with no spouse on the roster. */
const clientOnly: OwnerMatchFamilyMember[] = [
  { id: "c", role: "client", firstName: "John", lastName: "Smith" },
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

  it("does not treat 'disjoint' as a joint cue (word-boundary)", () => {
    // Only the client name matches; the 'joint' substring inside 'disjoint'
    // must not trigger 50/50 joint synthesis.
    expect(matchOwnersFromHint("John Smith disjoint note", undefined, fam)).toEqual([
      { kind: "family_member", familyMemberId: "c", percent: 1 },
    ]);
  });
});

describe("resolveOwnersFromHint — source", () => {
  it("reports 'hint' when the registration name resolves to a family member", () => {
    expect(resolveOwnersFromHint("John A. Smith", undefined, fam).source).toBe("hint");
  });

  it("reports 'hint' when a joint cue fires with both spouses present", () => {
    expect(resolveOwnersFromHint("Smith Family JTWROS", "joint", fam).source).toBe("hint");
  });

  it("reports 'coarse' for client/spouse/joint backed by a matching roster", () => {
    expect(resolveOwnersFromHint(undefined, "client", fam).source).toBe("coarse");
    expect(resolveOwnersFromHint(undefined, "spouse", fam).source).toBe("coarse");
    expect(resolveOwnersFromHint(undefined, "joint", fam).source).toBe("coarse");
  });

  it("reports 'default' when there is no hint and no coarse enum", () => {
    const res = resolveOwnersFromHint(undefined, undefined, fam);
    // Owners are still the client — the commit step needs somebody to write.
    expect(res.owners).toEqual([{ kind: "family_member", familyMemberId: "c", percent: 1 }]);
    expect(res.source).toBe("default");
  });

  it("reports 'default' when the hint names nobody on the roster", () => {
    const res = resolveOwnersFromHint("Smith Family Trust", undefined, fam);
    expect(res.owners).toEqual([{ kind: "family_member", familyMemberId: "c", percent: 1 }]);
    expect(res.source).toBe("default");
  });

  it("reports 'default' when coarse 'spouse' degrades to the client (no spouse)", () => {
    const res = resolveOwnersFromHint(undefined, "spouse", clientOnly);
    // The enum said spouse; there is no spouse, so this silently became the
    // client. Owners are unchanged for the commit path, but it is NOT evidence.
    expect(res.owners).toEqual([{ kind: "family_member", familyMemberId: "c", percent: 1 }]);
    expect(res.source).toBe("default");
  });

  it("reports 'default' when coarse 'joint' degrades to the client (no spouse)", () => {
    const res = resolveOwnersFromHint(undefined, "joint", clientOnly);
    expect(res.owners).toEqual([{ kind: "family_member", familyMemberId: "c", percent: 1 }]);
    expect(res.source).toBe("default");
  });

  it("reports 'default' with no owners when the roster is empty", () => {
    expect(resolveOwnersFromHint("Nobody", undefined, [])).toEqual({
      owners: [],
      source: "default",
    });
  });

  it("matchOwnersFromHint returns exactly resolveOwnersFromHint's owners", () => {
    const cases: Array<[string | undefined, "client" | "spouse" | "joint" | undefined]> = [
      ["John A. Smith", undefined],
      ["Smith Family JTWROS", "joint"],
      ["Acme Holdings Trust", "spouse"],
      [undefined, "joint"],
      [undefined, undefined],
    ];
    for (const [hint, coarse] of cases) {
      expect(matchOwnersFromHint(hint, coarse, fam)).toEqual(
        resolveOwnersFromHint(hint, coarse, fam).owners,
      );
    }
  });
});
