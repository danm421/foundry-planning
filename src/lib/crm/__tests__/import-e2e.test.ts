import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  parseCsv,
  dryRun,
  commit,
  type ImportDecision,
} from "../import";
import { createCrmHousehold } from "../households";
import { syncHouseholdNameFromContacts } from "../sync-household-name";

// End-to-end import scenario against the real DB. Seeds a household,
// parses a CSV string with five rows (one a typo-near-match of the
// seed), runs the dry-run, then commits with the duplicate marked
// "skip" and asserts the row counts.

// Inlined into the mock factories because vi.mock is hoisted above any
// top-level `const` declarations — referencing an outer var here throws.
vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn().mockResolvedValue("test_org_import_e2e"),
  };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({
      userId: "test_user_import_e2e",
      orgId: "test_org_import_e2e",
    }),
  };
});

const ORG_ID = "test_org_import_e2e";

async function purge() {
  // Order matters: contacts -> households (FK).
  const all = await db
    .select({ id: crmHouseholds.id })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, ORG_ID));
  for (const h of all) {
    await db
      .delete(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, h.id));
  }
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG_ID));
}

describe("CRM bulk import — e2e", () => {
  beforeAll(async () => {
    await purge();
  });

  afterAll(async () => {
    await purge();
  });

  it("seeds a household, dry-runs a CSV, then commits with a skipped duplicate", async () => {
    // 1. Seed an existing household.
    const seeded = await createCrmHousehold({
      name: "Smith Family",
      status: "active",
      advisorId: "test_advisor_seed",
    });
    expect(seeded.id).toBeDefined();

    // 2. Parse a CSV with 5 households — 2 with spouses, 1 typo-near-match.
    const header =
      "household_name,primary_first,primary_last,primary_email,primary_phone,primary_dob,spouse_first,spouse_last,spouse_email,spouse_dob,advisor_id,status,notes,address_line1,city,state,postal_code";
    const rows = [
      // Typo near-match to seeded "Smith Family"
      "Smith Familey,Mike,Smith,mike@example.com,,,Anne,Smith,anne@example.com,,test_advisor_e2e,prospect,,,,,",
      "Johnson Trust,Bob,Johnson,bob@example.com,,,,,,,test_advisor_e2e,prospect,,,,,",
      "Patel Estate,Raj,Patel,raj@example.com,,,Priya,Patel,priya@example.com,,test_advisor_e2e,active,,,,,",
      "Garcia Family,Maria,Garcia,maria@example.com,,,,,,,test_advisor_e2e,prospect,,,,,",
      "Zellweger Holdings,Renée,Zellweger,renee@example.com,,,,,,,test_advisor_e2e,prospect,,,,,",
    ];
    const buf = Buffer.from([header, ...rows].join("\n"), "utf8");
    const parsed = await parseCsv(buf);
    expect(parsed.errors).toEqual([]);
    expect(parsed.proposed).toHaveLength(5);

    // 3. Dry-run against the live list. The seeded "Smith Family" must
    //    surface as the top match for "Smith Familey".
    const dryRunResult = await dryRun(parsed.proposed);
    expect(dryRunResult.rowsToCreate).toHaveLength(4);
    expect(dryRunResult.duplicates).toHaveLength(1);
    expect(dryRunResult.duplicates[0].matches[0].id).toBe(seeded.id);
    expect(dryRunResult.duplicates[0].matches[0].name).toBe("Smith Family");
    expect(dryRunResult.duplicates[0].matches[0].score).toBeGreaterThanOrEqual(
      75,
    );

    // 4. Build decisions: create the 4 non-dupes, skip the matched one.
    const decisions: ImportDecision[] = [
      ...dryRunResult.rowsToCreate.map<ImportDecision>((row) => ({
        action: "create",
        row,
      })),
      ...dryRunResult.duplicates.map<ImportDecision>((d) => ({
        action: "skip",
        row: d.row,
        matchedHouseholdId: d.matches[0].id,
      })),
    ];
    const result = await commit(decisions);
    expect(result.errors).toEqual([]);
    expect(result.created).toBe(4);
    expect(result.skipped).toBe(1);

    // 5. Confirm the row counts in the DB: 1 seeded + 4 created = 5.
    const all = await db
      .select({ id: crmHouseholds.id, name: crmHouseholds.name })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.firmId, ORG_ID));
    expect(all).toHaveLength(5);
    const names = all.map((h) => h.name).sort();
    expect(names).toEqual([
      "Garcia Family",
      "Johnson Trust",
      "Patel Estate",
      "Smith Family",
      "Zellweger Holdings",
    ]);

    // Spouses → expect 2 households to have a spouse contact.
    const contactCounts = await Promise.all(
      all.map(async (h) => {
        const cs = await db
          .select()
          .from(crmHouseholdContacts)
          .where(eq(crmHouseholdContacts.householdId, h.id));
        return { name: h.name, contacts: cs.length };
      }),
    );
    const patel = contactCounts.find((c) => c.name === "Patel Estate");
    expect(patel?.contacts).toBe(2);
  });

  it("locks a CSV-supplied household name so later contact edits can't clobber it", async () => {
    // Clean slate so the firmId-scoped lookups below are unambiguous.
    await purge();

    // Import a row whose household name is deliberately unlike the derived
    // one ("Bob Johnson") — same shape as the "Johnson Trust" row in the
    // dry-run scenario above, committed directly since dedup isn't the
    // point of this test.
    const header =
      "household_name,primary_first,primary_last,primary_email,primary_phone,primary_dob,spouse_first,spouse_last,spouse_email,spouse_dob,advisor_id,status,notes,address_line1,city,state,postal_code";
    const rows = [
      "Johnson Trust,Bob,Johnson,bob@example.com,,,,,,,test_advisor_e2e,prospect,,,,,",
    ];
    const buf = Buffer.from([header, ...rows].join("\n"), "utf8");
    const parsed = await parseCsv(buf);
    expect(parsed.errors).toEqual([]);
    expect(parsed.proposed).toHaveLength(1);

    const decisions: ImportDecision[] = parsed.proposed.map((row) => ({
      action: "create",
      row,
    }));
    const { created } = await commit(decisions);
    expect(created).toBe(1);

    const [h] = await db
      .select({
        id: crmHouseholds.id,
        name: crmHouseholds.name,
        nameIsCustom: crmHouseholds.nameIsCustom,
      })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.firmId, ORG_ID));
    expect(h.name).toBe("Johnson Trust");
    expect(h.nameIsCustom).toBe(true);

    // The whole point: a later rename must NOT rewrite it.
    await syncHouseholdNameFromContacts(db, h.id);
    const [after] = await db
      .select({ name: crmHouseholds.name })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.firmId, ORG_ID));
    expect(after.name).toBe("Johnson Trust");
  });

  it("does not lock a whitespace-only household name", async () => {
    // Clean slate so the firmId-scoped lookup below is unambiguous.
    await purge();

    // parseCsv trims cells before validation, so a whitespace-only name
    // never reaches commit() via the CSV path — but the commit API route
    // re-validates decisions with a schema that doesn't trim, so a
    // whitespace-only name CAN reach commit() directly from there. Drive
    // commit() the same way to prove the lock condition's false branch.
    const decisions: ImportDecision[] = [
      {
        action: "create",
        row: {
          household: {
            name: "   ",
            advisorId: "test_advisor_e2e",
            status: "prospect",
          },
          primary: { role: "primary", firstName: "Ann", lastName: "NoName" },
        },
      },
    ];
    const { created } = await commit(decisions);
    expect(created).toBe(1);

    const [h] = await db
      .select({ nameIsCustom: crmHouseholds.nameIsCustom })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.firmId, ORG_ID));
    expect(h.nameIsCustom).toBe(false);
  });
});
