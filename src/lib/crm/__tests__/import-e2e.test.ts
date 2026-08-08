import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readGrid, detectMapping, buildPreview, commit, type ImportDecision } from "../import";
import { createCrmHousehold } from "../households";
import { syncHouseholdNameFromContacts } from "../sync-household-name";

// End-to-end import scenario against the real DB. Reads a messy CSV through
// the full readGrid -> detectMapping -> buildPreview pipeline, then commits
// with the duplicate marked "skip" and asserts the row counts and the
// session-assigned advisor.

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

  it("imports a messy file end to end and assigns the session advisor", async () => {
    const seeded = await createCrmHousehold({
      name: "Jane Smyth",
      status: "active",
      advisorId: "test_advisor_seed",
    });
    expect(seeded.id).toBeDefined();

    // Shuffled headers, no household_name column, no advisor column, a spouse
    // with no surname, an Excel-serial DOB, and a near-duplicate of the seed
    // (the row has no household_name column, so its name is derived as
    // "Jane Smith" — a one-letter typo of the seeded "Jane Smyth").
    const buf = Buffer.from(
      [
        "Last Name,First Name,Spouse,DOB,State",
        "Smith,Jane,,29221,Illinois",       // near-match of seeded "Jane Smyth"
        "Jones,Bob,Carol,1/15/1970,IL",
        "Nguyen,Minh,,,TX",
        ",Orphan,,,",                        // row error: no last name
      ].join("\n"),
      "utf8",
    );

    const grid = await readGrid(buf);
    const mapping = detectMapping(grid[0].map(String));
    const preview = await buildPreview(grid.slice(1), mapping);

    expect(preview.rows).toHaveLength(4);
    expect(preview.rows[3].errors).toHaveLength(1);
    expect(preview.rows[0].primary.dateOfBirth).toBe("1980-01-01");
    expect(preview.rows[1].household.name).toBe("Bob & Carol Jones");
    expect(preview.rows[1].spouse?.lastName).toBe("Jones");
    expect(preview.duplicates.map((d) => d.rowIndex)).toContain(0);

    const decisions: ImportDecision[] = preview.rows
      .filter((r) => r.errors.length === 0)
      .map((r) => {
        const dup = preview.duplicates.find((d) => d.rowIndex === r.rowIndex);
        const row = { household: r.household, primary: r.primary, spouse: r.spouse };
        return dup
          ? { action: "skip" as const, row, matchedHouseholdId: dup.matches[0].id }
          : { action: "create" as const, row };
      });

    const result = await commit(decisions);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);

    const landed = await db
      .select()
      .from(crmHouseholds)
      .where(eq(crmHouseholds.firmId, ORG_ID));
    const jones = landed.find((h) => h.name === "Bob & Carol Jones");
    expect(jones).toBeDefined();
    // The session user, NOT anything from the file.
    expect(jones!.advisorId).toBe("test_user_import_e2e");
    expect(jones!.state).toBe("IL");
    expect(jones!.nameIsCustom).toBe(false);
  });

  it("locks a CSV-supplied household name so later contact edits can't clobber it", async () => {
    // Clean slate so the firmId-scoped lookups below are unambiguous.
    await purge();

    // Import a row whose household name is deliberately unlike the derived
    // one ("Bob Johnson") — dedup isn't the point of this test, so it's
    // committed directly.
    const buf = Buffer.from(
      [
        "Household Name,Last Name,First Name",
        "Johnson Trust,Johnson,Bob",
      ].join("\n"),
      "utf8",
    );

    const grid = await readGrid(buf);
    const mapping = detectMapping(grid[0].map(String));
    const preview = await buildPreview(grid.slice(1), mapping);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].errors).toEqual([]);

    const decisions: ImportDecision[] = preview.rows.map((r) => ({
      action: "create" as const,
      row: { household: r.household, primary: r.primary, spouse: r.spouse },
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

    // buildRows trims cells and derives nameIsCustom from the trimmed value,
    // so a whitespace-only name never reaches commit() with nameIsCustom set
    // via the file-parsing path — but the commit API route re-validates
    // decisions with a schema that doesn't trim, so a bare whitespace name
    // (with no nameIsCustom at all) CAN reach commit() directly from there.
    // commit() no longer recomputes nameIsCustom (rows.ts already sets it),
    // so this proves createCrmHousehold's own default still lands `false`
    // rather than a refactor accidentally defaulting it to `true`.
    const decisions: ImportDecision[] = [
      {
        action: "create",
        row: {
          household: { name: "   ", status: "prospect" },
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
