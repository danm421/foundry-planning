import { describe, it, expect } from "vitest";
import {
  buildHouseholdName,
  deriveHouseholdNameFromContacts,
  formatNameLastFirst,
  roleAffectsHouseholdName,
} from "../household-name";

describe("buildHouseholdName", () => {
  it("returns 'First Last' when there is no spouse", () => {
    expect(
      buildHouseholdName({ firstName: "Michael", lastName: "Jordan" }),
    ).toBe("Michael Jordan");
  });

  it("returns 'First & SpouseFirst Last' when spouse shares the last name", () => {
    expect(
      buildHouseholdName({
        firstName: "Michael",
        lastName: "Jordan",
        spouseFirstName: "Jane",
        spouseLastName: "Jordan",
      }),
    ).toBe("Michael & Jane Jordan");
  });

  it("inherits the client's last name when spouseLastName is blank", () => {
    expect(
      buildHouseholdName({
        firstName: "Michael",
        lastName: "Jordan",
        spouseFirstName: "Jane",
        spouseLastName: "",
      }),
    ).toBe("Michael & Jane Jordan");
  });

  it("returns 'First Last & SpouseFirst SpouseLast' when last names differ", () => {
    expect(
      buildHouseholdName({
        firstName: "Michael",
        lastName: "Jordan",
        spouseFirstName: "Jane",
        spouseLastName: "Smith",
      }),
    ).toBe("Michael Jordan & Jane Smith");
  });

  it("trims surrounding whitespace from inputs", () => {
    expect(
      buildHouseholdName({
        firstName: "  Michael  ",
        lastName: "  Jordan  ",
        spouseFirstName: "  Jane  ",
        spouseLastName: "  Smith  ",
      }),
    ).toBe("Michael Jordan & Jane Smith");
  });
});

describe("deriveHouseholdNameFromContacts", () => {
  it("derives a single-person name from the primary contact", () => {
    expect(
      deriveHouseholdNameFromContacts([
        { role: "primary", firstName: "Michael", lastName: "Jordan" },
      ]),
    ).toBe("Michael Jordan");
  });

  it("derives a couple name from primary + spouse", () => {
    expect(
      deriveHouseholdNameFromContacts([
        { role: "primary", firstName: "Michael", lastName: "Jordan" },
        { role: "spouse", firstName: "Jane", lastName: "Jordan" },
      ]),
    ).toBe("Michael & Jane Jordan");
  });

  it("ignores dependents and other roles", () => {
    expect(
      deriveHouseholdNameFromContacts([
        { role: "dependent", firstName: "Kid", lastName: "Jordan" },
        { role: "primary", firstName: "Michael", lastName: "Jordan" },
        { role: "other", firstName: "Cousin", lastName: "Pippen" },
      ]),
    ).toBe("Michael Jordan");
  });

  it("returns null when there is no primary contact", () => {
    expect(
      deriveHouseholdNameFromContacts([
        { role: "spouse", firstName: "Jane", lastName: "Jordan" },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty contact list", () => {
    expect(deriveHouseholdNameFromContacts([])).toBeNull();
  });
});

describe("formatNameLastFirst", () => {
  it("puts the last name first, separated by a comma", () => {
    expect(formatNameLastFirst({ firstName: "John", lastName: "Cooper" })).toBe("Cooper, John");
  });

  it("drops the comma when only one half is present", () => {
    expect(formatNameLastFirst({ firstName: "John", lastName: "" })).toBe("John");
    expect(formatNameLastFirst({ firstName: "", lastName: "Cooper" })).toBe("Cooper");
  });

  it("treats whitespace-only halves as missing, and an empty name as empty", () => {
    expect(formatNameLastFirst({ firstName: "  John ", lastName: "   " })).toBe("John");
    expect(formatNameLastFirst({ firstName: " ", lastName: " " })).toBe("");
  });
});

describe("roleAffectsHouseholdName", () => {
  it("is true for the primary and spouse roles", () => {
    expect(roleAffectsHouseholdName("primary")).toBe(true);
    expect(roleAffectsHouseholdName("spouse")).toBe(true);
  });

  it("is false for dependents and other roles", () => {
    expect(roleAffectsHouseholdName("dependent")).toBe(false);
    expect(roleAffectsHouseholdName("other")).toBe(false);
  });
});
