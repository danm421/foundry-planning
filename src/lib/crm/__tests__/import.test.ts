import { describe, it, expect, vi } from "vitest";
import { readGrid, detectMapping, buildPreview } from "../import";

// End-to-end unit tests for the bulk CRM import lib, through the pure
// readGrid -> detectMapping -> buildPreview pipeline. buildPreview is
// exercised against an injected `existingHouseholds` list to avoid hitting
// the DB. The full DB-backed scenario lives in import-e2e.test.ts.

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

const TEMPLATE_HEADER =
  "household_name,primary_first,primary_last,primary_email,primary_phone,primary_dob,spouse_first,spouse_last,spouse_email,spouse_dob,status,notes,address_line1,city,state,postal_code";

function csv(header: string, ...rows: string[]): Buffer {
  return Buffer.from([header, ...rows].join("\n"), "utf8");
}

async function parse(buf: Buffer, existing: { id: string; name: string }[] = []) {
  const grid = await readGrid(buf);
  const mapping = detectMapping(grid[0].map(String));
  return {
    mapping,
    preview: await buildPreview(grid.slice(1), mapping, [], {
      existingHouseholds: existing,
    }),
  };
}

describe("bulk import — end to end through the pure pipeline", () => {
  it("imports a full template row", async () => {
    const { preview } = await parse(
      csv(
        TEMPLATE_HEADER,
        "Smith Family,Jane,Smith,jane@example.com,555-0100,1980-01-01,John,Smith,john@example.com,1979-05-12,active,Notes here,123 Main,Austin,TX,73301",
      ),
    );
    const [r] = preview.rows;
    expect(r.errors).toEqual([]);
    expect(r.household.name).toBe("Smith Family");
    expect(r.household.status).toBe("active");
    expect(r.household.state).toBe("TX");
    expect(r.primary.lastName).toBe("Smith");
    expect(r.spouse?.firstName).toBe("John");
  });

  it("accepts a blank household name and derives it", async () => {
    const { preview } = await parse(
      csv(TEMPLATE_HEADER, ",Jane,Smith,,,,John,,,,,,,,,"),
    );
    expect(preview.rows[0].errors).toEqual([]);
    expect(preview.rows[0].household.name).toBe("Jane & John Smith");
  });

  it("accepts a file whose columns are shuffled and renamed", async () => {
    const { preview } = await parse(
      csv("Last Name,First Name,Email,Date of Birth", "Smith,Jane,jane@example.com,1/15/1970"),
    );
    const [r] = preview.rows;
    expect(r.errors).toEqual([]);
    expect(r.primary.firstName).toBe("Jane");
    expect(r.primary.dateOfBirth).toBe("1970-01-15");
    expect(r.household.name).toBe("Jane Smith");
  });

  it("ignores a legacy advisor_id column instead of failing", async () => {
    const legacy =
      "household_name,primary_first,primary_last,primary_email,primary_phone,primary_dob,spouse_first,spouse_last,spouse_email,spouse_dob,advisor_id,status,notes,address_line1,city,state,postal_code";
    const { mapping, preview } = await parse(
      csv(legacy, "Smith Family,Jane,Smith,,,,,,,,user_abc,active,,,,,"),
    );
    expect(Object.values(mapping)).not.toContain(10);
    expect(preview.rows[0].errors).toEqual([]);
    expect(preview.rows[0].household.status).toBe("active");
  });

  it("keeps a row importable when only the primary name is present", async () => {
    const { preview } = await parse(csv("first name,last name", "Jane,Smith"));
    expect(preview.rows[0].errors).toEqual([]);
  });

  it("flags a near-match against an existing household", async () => {
    const { preview } = await parse(
      csv("first name,last name", "Jane,Smith"),
      [{ id: "hh-1", name: "Jane Smith" }],
    );
    expect(preview.duplicates).toHaveLength(1);
    expect(preview.duplicates[0].rowIndex).toBe(0);
    expect(preview.duplicates[0].matches[0].id).toBe("hh-1");
  });

  it("reports truncation past the row cap", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => `Jane${i},Smith`);
    const { preview } = await parse(csv("first name,last name", ...many));
    expect(preview.truncated).toBe(true);
    expect(preview.rows).toHaveLength(1000);
  });
});
