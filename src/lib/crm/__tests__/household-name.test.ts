import { describe, it, expect } from "vitest";
import {
  buildHouseholdName,
  deriveHouseholdNameFromContacts,
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
