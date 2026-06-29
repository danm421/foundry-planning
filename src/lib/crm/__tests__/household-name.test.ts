import { describe, it, expect } from "vitest";
import {
  buildHouseholdName,
  deriveHouseholdNameFromContacts,
  resolveAutoHouseholdName,
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

describe("resolveAutoHouseholdName", () => {
  it("returns the new name when the stored name was still auto-generated", () => {
    expect(
      resolveAutoHouseholdName({
        storedName: "Michael Jordan",
        prevName: "Michael Jordan",
        newName: "Michael Jorden",
      }),
    ).toBe("Michael Jorden");
  });

  it("preserves a manually customized name (stored != prev)", () => {
    expect(
      resolveAutoHouseholdName({
        storedName: "The Jordan Family Trust",
        prevName: "Michael Jordan",
        newName: "Michael Jorden",
      }),
    ).toBeNull();
  });

  it("no-ops when the derived name is unchanged", () => {
    expect(
      resolveAutoHouseholdName({
        storedName: "Michael Jordan",
        prevName: "Michael Jordan",
        newName: "Michael Jordan",
      }),
    ).toBeNull();
  });

  it("returns null when the previous name cannot be derived", () => {
    expect(
      resolveAutoHouseholdName({
        storedName: "Michael Jordan",
        prevName: null,
        newName: "Michael Jorden",
      }),
    ).toBeNull();
  });

  it("returns null when the new name cannot be derived", () => {
    expect(
      resolveAutoHouseholdName({
        storedName: "Michael Jordan",
        prevName: "Michael Jordan",
        newName: null,
      }),
    ).toBeNull();
  });
});
