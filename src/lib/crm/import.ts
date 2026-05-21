import * as XLSX from "xlsx";
import * as fuzzball from "fuzzball";
import { ZodError } from "zod";
import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import {
  createCrmHouseholdSchema,
  createCrmContactSchema,
  type CreateCrmHouseholdInput,
  type CreateCrmContactInput,
} from "./schemas";
import { createCrmHousehold } from "./households";
import { createCrmContact } from "./contacts";
import { listCrmHouseholds } from "./households";

// Canonical column list. We refuse to parse a file whose header row
// doesn't match exactly — silently mapping mismatched columns produces
// confidently-wrong imports, which is the worst possible bulk-load
// failure mode.
export const IMPORT_COLUMNS = [
  "household_name",
  "primary_first",
  "primary_last",
  "primary_email",
  "primary_phone",
  "primary_dob",
  "spouse_first",
  "spouse_last",
  "spouse_email",
  "spouse_dob",
  "advisor_id",
  "status",
  "notes",
  "address_line1",
  "city",
  "state",
  "postal_code",
] as const;

const DEDUP_THRESHOLD = 75;
const MAX_MATCHES = 3;

export type ProposedHousehold = {
  household: CreateCrmHouseholdInput;
  primary: CreateCrmContactInput;
  spouse?: CreateCrmContactInput;
};

export type ImportRowError = {
  rowIndex: number;
  messages: string[];
};

export type DryRunMatch = {
  id: string;
  name: string;
  score: number;
};

export type DryRunResult = {
  rowsToCreate: ProposedHousehold[];
  duplicates: { row: ProposedHousehold; matches: DryRunMatch[] }[];
  errors: ImportRowError[];
};

export type ImportDecision =
  | { action: "create"; row: ProposedHousehold }
  | { action: "skip"; row: ProposedHousehold; matchedHouseholdId: string };

export type ParseResult = {
  proposed: ProposedHousehold[];
  errors: ImportRowError[];
};

// --- parseCsv ---------------------------------------------------------

/**
 * Parse a CSV (or single-sheet xlsx) buffer into proposed households.
 *
 * Validation:
 *  - The first row MUST be the canonical header — throws if mismatched.
 *  - Each subsequent row is validated against the household + contact
 *    Zod schemas; invalid rows are pushed to `errors` and never reach
 *    `proposed`. Empty all-blank rows are silently skipped.
 */
export function parseCsv(buffer: Buffer): ParseResult {
  // raw:true + cellDates:false keeps DOB columns as the literal
  // `YYYY-MM-DD` string the advisor typed. Without it xlsx eagerly
  // reformats anything that smells like a date into locale-specific
  // `M/D/YY` strings, which destroys ISO-date validation downstream.
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Empty workbook");
  }
  const sheet = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  if (rows.length === 0) {
    throw new Error("CSV has no rows");
  }

  const header = rows[0].map((h) => String(h).trim());
  if (header.length !== IMPORT_COLUMNS.length) {
    throw new Error(
      `Invalid header: expected ${IMPORT_COLUMNS.length} columns, got ${header.length}`,
    );
  }
  for (let i = 0; i < IMPORT_COLUMNS.length; i++) {
    if (header[i] !== IMPORT_COLUMNS[i]) {
      throw new Error(
        `Invalid header at column ${i + 1}: expected "${IMPORT_COLUMNS[i]}", got "${header[i]}"`,
      );
    }
  }

  const proposed: ProposedHousehold[] = [];
  const errors: ImportRowError[] = [];

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r] ?? [];
    // Pad short rows with empty strings so the column indexing below is
    // stable. xlsx sometimes truncates trailing-empty cells.
    const cells: string[] = IMPORT_COLUMNS.map((_, i) =>
      String(raw[i] ?? "").trim(),
    );
    if (cells.every((c) => c === "")) continue;

    const rowIndex = r - 1; // 0-based data-row index for caller display

    const messages: string[] = [];

    const householdRaw = {
      name: cells[0],
      advisorId: cells[10],
      status: cells[11] || "prospect",
      notes: cells[12] || undefined,
    };
    const householdParsed = createCrmHouseholdSchema.safeParse(householdRaw);

    const primaryRaw: Record<string, string | undefined> = {
      role: "primary",
      firstName: cells[1],
      lastName: cells[2],
      email: cells[3] || undefined,
      phone: cells[4] || undefined,
      dateOfBirth: cells[5] || undefined,
      addressLine1: cells[13] || undefined,
      city: cells[14] || undefined,
      state: cells[15] || undefined,
      postalCode: cells[16] || undefined,
    };
    const primaryParsed = createCrmContactSchema.safeParse(primaryRaw);

    let spouseParsed:
      | { success: true; data: CreateCrmContactInput }
      | { success: false; error: ZodError }
      | undefined;
    const hasSpouse =
      cells[6] !== "" || cells[7] !== "" || cells[8] !== "" || cells[9] !== "";
    if (hasSpouse) {
      const spouseRaw: Record<string, string | undefined> = {
        role: "spouse",
        firstName: cells[6],
        lastName: cells[7],
        email: cells[8] || undefined,
        dateOfBirth: cells[9] || undefined,
      };
      spouseParsed = createCrmContactSchema.safeParse(spouseRaw);
    }

    if (!householdParsed.success) {
      for (const issue of householdParsed.error.issues) {
        messages.push(`household.${issue.path.join(".")}: ${issue.message}`);
      }
    }
    if (!primaryParsed.success) {
      for (const issue of primaryParsed.error.issues) {
        messages.push(`primary.${issue.path.join(".")}: ${issue.message}`);
      }
    }
    if (spouseParsed && !spouseParsed.success) {
      for (const issue of spouseParsed.error.issues) {
        messages.push(`spouse.${issue.path.join(".")}: ${issue.message}`);
      }
    }

    if (messages.length > 0) {
      errors.push({ rowIndex, messages });
      continue;
    }

    proposed.push({
      household: householdParsed.success
        ? householdParsed.data
        : (householdRaw as unknown as CreateCrmHouseholdInput),
      primary: primaryParsed.success
        ? primaryParsed.data
        : (primaryRaw as unknown as CreateCrmContactInput),
      spouse:
        spouseParsed && spouseParsed.success ? spouseParsed.data : undefined,
    });
  }

  return { proposed, errors };
}

// --- dryRun -----------------------------------------------------------

/**
 * Strip diacritics + lowercase for fuzzy comparison. We need both
 * `García` ↔ `Garcia` and `Smith` ↔ `smith` to score as exact matches,
 * which `token_set_ratio` doesn't do on its own.
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

type ExistingForDedup = { id: string; name: string };

/**
 * Per-row fuzzy match against the firm's existing CRM households.
 *
 * In production, `opts.existingHouseholds` is omitted and we pull the
 * list via `listCrmHouseholds({ limit: 1000 })`. The override is for
 * unit tests so the matcher can be exercised without DB IO.
 */
export async function dryRun(
  rows: ProposedHousehold[],
  opts: {
    existingHouseholds?: ExistingForDedup[];
    errors?: ImportRowError[];
  } = {},
): Promise<DryRunResult> {
  let existing: ExistingForDedup[];
  if (opts.existingHouseholds) {
    existing = opts.existingHouseholds;
  } else {
    const live = await listCrmHouseholds({ limit: 1000 });
    existing = live.map((h) => ({ id: h.id, name: h.name }));
  }

  const normExisting = existing.map((h) => ({
    ...h,
    norm: normalize(h.name),
  }));

  const rowsToCreate: ProposedHousehold[] = [];
  const duplicates: DryRunResult["duplicates"] = [];

  for (const row of rows) {
    const candidateName = normalize(row.household.name);
    const matches: DryRunMatch[] = [];
    for (const cand of normExisting) {
      const score = fuzzball.token_set_ratio(candidateName, cand.norm);
      if (score >= DEDUP_THRESHOLD) {
        matches.push({ id: cand.id, name: cand.name, score });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, MAX_MATCHES);

    if (top.length > 0) {
      duplicates.push({ row, matches: top });
    } else {
      rowsToCreate.push(row);
    }
  }

  return { rowsToCreate, duplicates, errors: opts.errors ?? [] };
}

// --- commit -----------------------------------------------------------

/**
 * Apply user-resolved decisions. Each `create` decision provisions a
 * household, primary contact, and (optionally) spouse contact in
 * dependency order; failures isolate to a single row so a partial
 * import still produces audit + per-household records for the rows that
 * succeeded. `skip` decisions are no-ops by design.
 *
 * One firm-level audit row per call summarizes the totals; the
 * per-resource audit + activity events are already written by
 * `createCrmHousehold` / `createCrmContact`.
 */
export async function commit(
  decisions: ImportDecision[],
): Promise<{ created: number; skipped: number; errors: ImportRowError[] }> {
  const firmId = await requireOrgId();
  let created = 0;
  let skipped = 0;
  const errors: ImportRowError[] = [];

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (d.action === "skip") {
      skipped++;
      continue;
    }
    try {
      const household = await createCrmHousehold(d.row.household);
      await createCrmContact(household.id, d.row.primary);
      if (d.row.spouse) {
        await createCrmContact(household.id, d.row.spouse);
      }
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ rowIndex: i, messages: [msg] });
    }
  }

  await recordAudit({
    action: "crm.import.commit",
    resourceType: "crm_import",
    resourceId: `${firmId}:${Date.now()}`,
    firmId,
    metadata: { created, skipped, errorCount: errors.length },
  });

  return { created, skipped, errors };
}

// Convenience re-export so callers can clean up post-test household
// rows without re-importing the schema themselves.
export const __testing = { crmHouseholds, db, eq };
