import { describe, it, expect } from "vitest";
import { buildRows } from "../rows";
import type { ColumnMapping } from "../columns";

// Column layout used by most cases below — deliberately NOT template order.
const MAP: ColumnMapping = {
  primaryFirst: 0,
  primaryLast: 1,
  householdName: 2,
  spouseFirst: 3,
  spouseLast: 4,
  primaryDob: 5,
  primaryEmail: 6,
  status: 7,
  state: 8,
};

function rows(...data: (string | number)[][]) {
  return buildRows(data, MAP);
}

describe("buildRows — required fields", () => {
  it("imports a row with only a primary first and last name", () => {
    const [r] = rows(["Jane", "Smith"]);
    expect(r.errors).toEqual([]);
    expect(r.primary.firstName).toBe("Jane");
    expect(r.spouse).toBeUndefined();
  });

  it("errors when the primary last name is missing", () => {
    const [r] = rows(["Jane", ""]);
    expect(r.errors.map((e) => e.field)).toEqual(["primaryLast"]);
  });

  it("skips a completely blank row", () => {
    expect(rows(["", "", ""])).toHaveLength(0);
  });

  it("errors every row when no column is mapped to the primary name", () => {
    const [r] = buildRows([["Jane", "Smith"]], { householdName: 0 });
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("buildRows — household name", () => {
  it("derives the name from primary and spouse when the cell is blank", () => {
    const [r] = rows(["Jane", "Smith", "", "John"]);
    expect(r.household.name).toBe("Jane & John Smith");
    expect(r.household.nameIsCustom).toBe(false);
  });

  it("derives a solo name when there is no spouse", () => {
    const [r] = rows(["Jane", "Smith"]);
    expect(r.household.name).toBe("Jane Smith");
  });

  it("keeps both surnames when the spouse's differs", () => {
    const [r] = rows(["Jane", "Smith", "", "John", "Doe"]);
    expect(r.household.name).toBe("Jane Smith & John Doe");
  });

  it("locks a supplied name against later re-derivation", () => {
    const [r] = rows(["Jane", "Smith", "Johnson Trust"]);
    expect(r.household.name).toBe("Johnson Trust");
    expect(r.household.nameIsCustom).toBe(true);
  });

  it("does not lock a whitespace-only name", () => {
    const [r] = rows(["Jane", "Smith", "   "]);
    expect(r.household.name).toBe("Jane Smith");
    expect(r.household.nameIsCustom).toBe(false);
  });
});

describe("buildRows — spouse", () => {
  it("inherits the primary's last name when the spouse's is blank", () => {
    const [r] = rows(["Jane", "Smith", "", "John"]);
    expect(r.spouse?.lastName).toBe("Smith");
  });

  it("reads the spouse's own email and date of birth, not the primary's", () => {
    const map: ColumnMapping = {
      primaryFirst: 0,
      primaryLast: 1,
      spouseFirst: 2,
      spouseEmail: 3,
      spouseDob: 4,
      primaryEmail: 5,
      primaryDob: 6,
    };
    // The primary's own email and DOB columns are mapped but blank, so if the
    // spouse block ever read them instead of the spouse's, both legs below
    // flip: the spouse loses its values and the primary gains them.
    const [r] = buildRows(
      [["Jane", "Smith", "John", "john@example.com", "1979-03-04", "", ""]],
      map,
    );
    expect(r.errors).toEqual([]);
    expect(r.spouse?.email).toBe("john@example.com");
    expect(r.spouse?.dateOfBirth).toBe("1979-03-04");
    expect(r.primary.email).toBeUndefined();
    expect(r.primary.dateOfBirth).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("warns and drops the spouse when only spouse data, no spouse name, is present", () => {
    const map: ColumnMapping = { primaryFirst: 0, primaryLast: 1, spouseEmail: 2 };
    const [r] = buildRows([["Jane", "Smith", "john@example.com"]], map);
    expect(r.spouse).toBeUndefined();
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.field === "spouseFirst")).toBe(true);
  });
});

describe("buildRows — tolerant cells", () => {
  it("warns and blanks an unreadable date but still imports the row", () => {
    const [r] = rows(["Jane", "Smith", "", "", "", "sometime in 1980"]);
    expect(r.errors).toEqual([]);
    expect(r.primary.dateOfBirth).toBeUndefined();
    expect(r.warnings.some((w) => w.field === "primaryDob")).toBe(true);
  });

  it("accepts an Excel serial date", () => {
    const [r] = rows(["Jane", "Smith", "", "", "", 29221]);
    expect(r.primary.dateOfBirth).toBe("1980-01-01");
    expect(r.warnings).toEqual([]);
  });

  it("warns and drops an invalid email but still imports the row", () => {
    const [r] = rows(["Jane", "Smith", "", "", "", "", "not-an-email"]);
    expect(r.errors).toEqual([]);
    expect(r.primary.email).toBeUndefined();
    expect(r.warnings.some((w) => w.field === "primaryEmail")).toBe(true);
  });

  it("warns and falls back to prospect on an unknown status", () => {
    const [r] = rows(["Jane", "Smith", "", "", "", "", "", "VIP"]);
    expect(r.household.status).toBe("prospect");
    expect(r.warnings.some((w) => w.field === "status")).toBe(true);
  });

  it("puts the state on both the household and the primary contact", () => {
    const [r] = rows(["Jane", "Smith", "", "", "", "", "", "", "Illinois"]);
    expect(r.household.state).toBe("IL");
    expect(r.primary.state).toBe("IL");
  });

  it("warns and drops a non-USPS state", () => {
    const [r] = rows(["Jane", "Smith", "", "", "", "", "", "", "Ontario"]);
    expect(r.household.state).toBeUndefined();
    expect(r.warnings.some((w) => w.field === "state")).toBe(true);
  });

  it("warns and shortens an over-long cell but still imports the row", () => {
    const [r] = buildRows(
      [["Jane", "Smith", "n".repeat(6000)]],
      { primaryFirst: 0, primaryLast: 1, notes: 2 },
    );
    expect(r.errors).toEqual([]);
    expect(r.household.notes?.length).toBe(5000);
    expect(r.warnings.some((w) => w.field === "notes")).toBe(true);
  });

  it("zero-pads a numeric postal code", () => {
    const [r] = buildRows(
      [["Jane", "Smith", 2110]],
      { primaryFirst: 0, primaryLast: 1, postalCode: 2 },
    );
    expect(r.primary.postalCode).toBe("02110");
  });
});

describe("buildRows — overrides", () => {
  it("applies an override in place of the file's cell", () => {
    const out = buildRows([["Jane", ""]], MAP, [
      { rowIndex: 0, field: "primaryLast", value: "Smith" },
    ]);
    expect(out[0].errors).toEqual([]);
    expect(out[0].household.name).toBe("Jane Smith");
  });

  it("can fill a field that has no column at all", () => {
    const out = buildRows([["Jane", "Smith"]], MAP, [
      { rowIndex: 0, field: "primaryEmail", value: "jane@example.com" },
    ]);
    expect(out[0].primary.email).toBe("jane@example.com");
  });
});

describe("buildRows — row indices", () => {
  it("numbers rows by file position, skipping blanks", () => {
    const out = rows(["Jane", "Smith"], ["", ""], ["Bob", "Jones"]);
    expect(out.map((r) => r.rowIndex)).toEqual([0, 2]);
  });
});
