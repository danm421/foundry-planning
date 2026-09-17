import { describe, it, expect } from "vitest";
import type { OwnerMatchFamilyMember } from "@/lib/imports/owner-match";
import {
  buildOwnerOptions,
  groupOwnerOptions,
  optionValueToOwners,
  ownerDisplayNames,
  ownersToOptionValue,
  resolveOwnerDisplay,
} from "../owner-options";

const FAMILY: OwnerMatchFamilyMember[] = [
  { id: "c", role: "client", firstName: "Michael", lastName: "Sharesky" },
  { id: "s", role: "spouse", firstName: "Julia", lastName: "Sharesky" },
  { id: "k", role: "child", firstName: "Ellie", lastName: "Sharesky" },
];
const ENTITIES = [{ id: "t", name: "Sharesky Family Trust" }];
const OPTS = {};

describe("buildOwnerOptions", () => {
  it("offers every person and entity, household first", () => {
    const options = buildOwnerOptions(FAMILY, ENTITIES, OPTS);
    expect(options.map((o) => o.value)).toEqual(["fm:c", "fm:s", "fm:k", "joint", "ent:t"]);
  });

  it("labels every person by name alone, and the pair as joint", () => {
    const byValue = new Map(buildOwnerOptions(FAMILY, ENTITIES, OPTS).map((o) => [o.value, o.label]));
    expect(byValue.get("fm:c")).toBe("Michael Sharesky");
    expect(byValue.get("fm:s")).toBe("Julia Sharesky");
    expect(byValue.get("fm:k")).toBe("Ellie Sharesky");
    expect(byValue.get("joint")).toBe("Michael & Julia (joint)");
  });

  /**
   * The `account_owners_retirement_check` trigger holds these to one owner at
   * 100%, and `writeImportedOwners` silently collapses a multi-owner retirement
   * set rather than failing — so offering Joint would be a discarded pick.
   */
  it("withholds the joint option on every retirement sub-type", () => {
    for (const subType of ["traditional_ira", "roth_ira", "401k", "403b"]) {
      const values = buildOwnerOptions(FAMILY, ENTITIES, { ...OPTS, subType }).map((o) => o.value);
      expect(values).not.toContain("joint");
      expect(values).toContain("fm:c");
    }
  });

  it("withholds the joint option when the household has no co-client", () => {
    const soloValues = buildOwnerOptions([FAMILY[0]], [], OPTS).map((o) => o.value);
    expect(soloValues).toEqual(["fm:c"]);
  });

  it("groups household separately from entities, in order", () => {
    expect(groupOwnerOptions(buildOwnerOptions(FAMILY, ENTITIES, OPTS)).map((g) => g.group)).toEqual([
      "Household",
      "Trusts & entities",
    ]);
  });
});

describe("optionValueToOwners", () => {
  it("writes one family member at 100%", () => {
    expect(optionValueToOwners("fm:k", FAMILY)).toEqual([
      { kind: "family_member", familyMemberId: "k", percent: 1 },
    ]);
  });

  it("writes the two spouses at 50/50, summing to exactly 1", () => {
    const owners = optionValueToOwners("joint", FAMILY)!;
    expect(owners).toHaveLength(2);
    // `validateOwnersShape` rejects anything more than 0.0001 off 1.
    expect(owners.reduce((sum, o) => sum + o.percent, 0)).toBe(1);
  });

  it("writes an entity at 100%", () => {
    expect(optionValueToOwners("ent:t", FAMILY)).toEqual([
      { kind: "entity", entityId: "t", percent: 1 },
    ]);
  });

  /** Writing nothing beats writing a set that fails validation and silently
   *  falls back to the coarse enum. */
  it("refuses a pick the roster can no longer satisfy", () => {
    expect(optionValueToOwners("joint", [FAMILY[0]])).toBeNull();
    expect(optionValueToOwners("fm:ghost", FAMILY)).toBeNull();
    expect(optionValueToOwners("", FAMILY)).toBeNull();
  });
});

describe("ownersToOptionValue", () => {
  it("round-trips every option the picker offers", () => {
    for (const value of ["fm:c", "fm:k", "joint", "ent:t"]) {
      expect(ownersToOptionValue(optionValueToOwners(value, FAMILY)!, FAMILY)).toBe(value);
    }
  });

  it("recognises a joint pair whichever order it is stored in", () => {
    expect(
      ownersToOptionValue(
        [
          { kind: "family_member", familyMemberId: "s", percent: 0.5 },
          { kind: "family_member", familyMemberId: "c", percent: 0.5 },
        ],
        FAMILY,
      ),
    ).toBe("joint");
  });

  /** A split this one-select cell cannot name opens with nothing chosen —
   *  pre-selecting one member would imply the split was already that. */
  it("names no option for a split it cannot represent", () => {
    expect(
      ownersToOptionValue(
        [
          { kind: "family_member", familyMemberId: "c", percent: 0.7 },
          { kind: "family_member", familyMemberId: "s", percent: 0.3 },
        ],
        FAMILY,
      ),
    ).toBeNull();
    expect(ownersToOptionValue([], FAMILY)).toBeNull();
    expect(ownersToOptionValue(undefined, FAMILY)).toBeNull();
  });
});

describe("ownerDisplayNames", () => {
  it("names people and entities", () => {
    expect(
      ownerDisplayNames(
        [
          { kind: "family_member", familyMemberId: "c", percent: 0.5 },
          { kind: "entity", entityId: "t", percent: 0.5 },
        ],
        FAMILY,
        ENTITIES,
      ),
    ).toEqual(["Michael Sharesky", "Sharesky Family Trust"]);
  });

  /** A raw UUID tells the advisor less than nothing. */
  it("skips an owner whose id is no longer on the plan", () => {
    expect(
      ownerDisplayNames([{ kind: "family_member", familyMemberId: "gone", percent: 1 }], FAMILY, []),
    ).toEqual([]);
  });
});

describe("resolveOwnerDisplay", () => {
  it("reports recorded ownership as a fact", () => {
    expect(
      resolveOwnerDisplay(
        { owners: [{ kind: "family_member", familyMemberId: "k", percent: 1 }] },
        FAMILY,
        ENTITIES,
      ),
    ).toEqual({ names: ["Ellie Sharesky"], assumed: false });
  });

  /**
   * The point of the whole change: a printed registration line becomes the
   * plan's own person. Still `assumed` — nobody has confirmed it — but named.
   */
  it("resolves a printed registration line to a real name, marked a guess", () => {
    expect(
      resolveOwnerDisplay({ ownerNameHint: "MICHAEL V SHARESKY ROTH IRA" }, FAMILY, ENTITIES),
    ).toEqual({ names: ["Michael Sharesky"], assumed: true });
  });

  /**
   * Naming the coarse enum's people is more accurate than printing "Client":
   * with no `owners[]`, `synthesizeAccountOwners` writes those very people.
   */
  it("names the people the coarse enum would commit", () => {
    expect(resolveOwnerDisplay({ owner: "joint" }, FAMILY, ENTITIES)).toEqual({
      names: ["Michael Sharesky", "Julia Sharesky"],
      assumed: true,
    });
  });

  it("names nobody when the roster cannot answer", () => {
    expect(resolveOwnerDisplay({ ownerNameHint: "PATRICIA NGUYEN TTEE" }, [], [])).toEqual({
      names: [],
      assumed: true,
    });
  });
});
