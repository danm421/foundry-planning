import { describe, it, expect, vi } from "vitest";
import { parseCsv, dryRun } from "../import";

// Unit tests for the bulk CRM import lib. These tests stay in-memory:
// parseCsv has no IO, and dryRun is exercised against an injected
// `existingHouseholds` list to avoid hitting the DB. The full DB-backed
// scenario lives in import-e2e.test.ts.

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn().mockResolvedValue("test_org_import_unit"),
  };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({
      userId: "test_user",
      orgId: "test_org_import_unit",
    }),
  };
});

const HEADER =
  "household_name,primary_first,primary_last,primary_email,primary_phone,primary_dob,spouse_first,spouse_last,spouse_email,spouse_dob,advisor_id,status,notes,address_line1,city,state,postal_code";

function csv(...rows: string[]): Buffer {
  return Buffer.from([HEADER, ...rows].join("\n"), "utf8");
}

describe("parseCsv", () => {
  it("parses a single valid row into a proposed household", async () => {
    const buf = csv(
      "Smith Family,Jane,Smith,jane@example.com,,1980-01-01,John,Smith,john@example.com,1979-05-12,advisor_1,active,Notes here,123 Main,Austin,TX,73301",
    );
    const { proposed, errors } = await parseCsv(buf);
    expect(errors).toEqual([]);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].household.name).toBe("Smith Family");
    expect(proposed[0].household.advisorId).toBe("advisor_1");
    expect(proposed[0].household.status).toBe("active");
    expect(proposed[0].primary.firstName).toBe("Jane");
    expect(proposed[0].primary.lastName).toBe("Smith");
    expect(proposed[0].spouse?.firstName).toBe("John");
    expect(proposed[0].spouse?.email).toBe("john@example.com");
  });

  it("omits the spouse when spouse columns are blank", async () => {
    const buf = csv(
      "Solo Household,Solo,Person,solo@example.com,,1990-02-02,,,,,advisor_1,prospect,,,,,",
    );
    const { proposed, errors } = await parseCsv(buf);
    expect(errors).toEqual([]);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].spouse).toBeUndefined();
  });

  it("pushes validation failures to errors not proposed", async () => {
    // missing household_name + missing primary_first
    const buf = csv(
      ",, ,bad-email,,,,,,,advisor_1,prospect,,,,,",
    );
    const { proposed, errors } = await parseCsv(buf);
    expect(proposed).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowIndex).toBe(0);
    expect(errors[0].messages.length).toBeGreaterThan(0);
  });

  it("handles addresses on the primary contact", async () => {
    const buf = csv(
      "Addr Family,Anne,Addr,anne@example.com,,,,,,,advisor_2,prospect,,1 Main St,Boston,MA,02110",
    );
    const { proposed, errors } = await parseCsv(buf);
    expect(errors).toEqual([]);
    expect(proposed[0].primary.addressLine1).toBe("1 Main St");
    expect(proposed[0].primary.city).toBe("Boston");
    expect(proposed[0].primary.state).toBe("MA");
    expect(proposed[0].primary.postalCode).toBe("02110");
  });

  it("requires the header row to match exactly", async () => {
    const wrong = Buffer.from(
      "household_name,primary_first\nFoo,Bar",
      "utf8",
    );
    await expect(parseCsv(wrong)).rejects.toThrow(/header/i);
  });
});

// dryRun is unit-tested by passing in a synthetic existingHouseholds list
// through the injectable overload — keeps DB out of these tests. The full
// DB-backed scenario lives in import-e2e.test.ts.
describe("dryRun dedup matcher", () => {
  const existing = [
    { id: "h1", name: "Smith Family" },
    { id: "h2", name: "Johnson Household" },
    { id: "h3", name: "García Estate" },
    { id: "h4", name: "Patel Family Trust" },
  ];

  async function row(name: string, first = "Anne", last = "X") {
    const buf = csv(
      `${name},${first},${last},anne@example.com,,,,,,,advisor_1,prospect,,,,,`,
    );
    return (await parseCsv(buf)).proposed[0];
  }

  it("flags an exact match as duplicate (score 100)", async () => {
    const proposed = [await row("Smith Family")];
    const result = await dryRun(proposed, { existingHouseholds: existing });
    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].matches[0]).toMatchObject({
      id: "h1",
      name: "Smith Family",
    });
    expect(result.duplicates[0].matches[0].score).toBe(100);
  });

  it("flags a close typo (Smith Famly) as duplicate above threshold", async () => {
    const proposed = [await row("Smith Famly")];
    const result = await dryRun(proposed, { existingHouseholds: existing });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].matches[0].id).toBe("h1");
    expect(result.duplicates[0].matches[0].score).toBeGreaterThanOrEqual(75);
  });

  it("falls into rowsToCreate when no candidate clears the 75 threshold", async () => {
    const proposed = [await row("Zzzz Quux Corp")];
    const result = await dryRun(proposed, { existingHouseholds: existing });
    expect(result.rowsToCreate).toHaveLength(1);
    expect(result.duplicates).toHaveLength(0);
  });

  it("is case insensitive", async () => {
    const proposed = [await row("smith family")];
    const result = await dryRun(proposed, { existingHouseholds: existing });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].matches[0].id).toBe("h1");
  });

  it("returns at most 3 matches and respects sort order", async () => {
    const many = [
      { id: "a", name: "Acme Family" },
      { id: "b", name: "Acme Familie" },
      { id: "c", name: "Acme Famile" },
      { id: "d", name: "Acme Famly" },
      { id: "e", name: "Acme Famili" },
    ];
    const proposed = [await row("Acme Family")];
    const result = await dryRun(proposed, { existingHouseholds: many });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].matches.length).toBeLessThanOrEqual(3);
    // The exact match must lead.
    expect(result.duplicates[0].matches[0].id).toBe("a");
    // Scores monotonically non-increasing.
    const scores = result.duplicates[0].matches.map((m) => m.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it("normalizes accents so García matches Garcia", async () => {
    const proposed = [await row("Garcia Estate")];
    const result = await dryRun(proposed, { existingHouseholds: existing });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].matches[0].id).toBe("h3");
  });
});
