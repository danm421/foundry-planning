import { describe, it, expect } from "vitest";
import { buildHouseholdName } from "../household-name";

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
