import { describe, it, expect } from "vitest";
import { deriveContactSections } from "../contact-sections";

const c = (role: string, id: string, familyMemberId: string | null = null) =>
  ({ id, role, familyMemberId }) as never;

describe("deriveContactSections", () => {
  it("splits roles into sections, primary before spouse", () => {
    const out = deriveContactSections(
      [c("spouse", "s1"), c("other", "o1"), c("primary", "p1")],
      [],
    );
    expect(out.primarySpouse.map((x: { id: string }) => x.id)).toEqual(["p1", "s1"]);
    expect(out.external.map((x: { id: string }) => x.id)).toEqual(["o1"]);
  });

  it("pairs family members with their linked contact rows", () => {
    const out = deriveContactSections(
      [c("dependent", "d1", "fm1"), c("dependent", "d2")],
      [{ id: "fm1" }, { id: "fm2" }],
    );
    expect(out.family).toEqual([
      { member: { id: "fm1" }, contact: { id: "d1", role: "dependent", familyMemberId: "fm1" } },
      { member: { id: "fm2" }, contact: null },
    ]);
    expect(out.unlinkedFamily.map((x: { id: string }) => x.id)).toEqual(["d2"]);
  });

  it("never folds a non-dependent row into a family card, even carrying a link", () => {
    // Without the role filter in byFmId this contact renders TWICE: once folded
    // into fm1's card and once in its own external section.
    const out = deriveContactSections([c("other", "o1", "fm1")], [{ id: "fm1" }]);
    expect(out.family).toEqual([{ member: { id: "fm1" }, contact: null }]);
    expect(out.external.map((x: { id: string }) => x.id)).toEqual(["o1"]);
  });

  it("treats a linked row whose member is missing as unlinked (never invisible)", () => {
    const out = deriveContactSections([c("dependent", "d1", "fm-gone")], []);
    expect(out.family).toEqual([]);
    expect(out.unlinkedFamily.map((x: { id: string }) => x.id)).toEqual(["d1"]);
  });
});
