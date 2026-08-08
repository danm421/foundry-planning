/**
 * Bulk CRM import — public surface.
 *
 * The implementation lives in ./import/*. This barrel pulls in exceljs and db,
 * so it is SERVER-ONLY: client components import ./import/columns and
 * ./import/rows directly instead.
 */
export { readGrid } from "./import/read-file";
export {
  IMPORT_FIELDS,
  TEMPLATE_HEADERS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  detectMapping,
  sanitizeMapping,
  normalizeHeader,
  type ImportField,
  type ColumnMapping,
} from "./import/columns";
export {
  buildRows,
  MAX_IMPORT_ROWS,
  type ParsedRow,
  type RowIssue,
  type RowOverride,
} from "./import/rows";
export {
  findDuplicates,
  type DuplicateMatch,
  type RowDuplicates,
} from "./import/dedup";
export { buildPreview, type PreviewResult } from "./import/preview";

// --- commit -------------------------------------------------------------
//
// `commit` has not moved yet — Task 6 relocates it to ./import/commit and
// re-derives its inputs (session advisor id, household residence) from
// ParsedRow instead of the legacy ProposedHousehold shape. Until then it
// stays here, unchanged, because src/app/api/crm/import/commit/route.ts
// still imports it from this module.

import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import type { CreateCrmHouseholdInput, CreateCrmContactInput } from "./schemas";
import { createCrmHousehold, deleteCrmHousehold } from "./households";
import { createCrmContact } from "./contacts";

export type ProposedHousehold = {
  household: CreateCrmHouseholdInput;
  primary: CreateCrmContactInput;
  spouse?: CreateCrmContactInput;
};

export type ImportRowError = {
  rowIndex: number;
  messages: string[];
};

export type ImportDecision =
  | { action: "create"; row: ProposedHousehold }
  | { action: "skip"; row: ProposedHousehold; matchedHouseholdId: string };

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
  let orphansCleanedUp = 0;
  const errors: ImportRowError[] = [];

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (d.action === "skip") {
      skipped++;
      continue;
    }
    let householdId: string | null = null;
    try {
      // An advisor typing a household name into the CSV is the same explicit
      // intent as ticking "Use a custom name" — lock it, so it survives the
      // contact seeding below AND every later rename.
      const household = await createCrmHousehold({
        ...d.row.household,
        nameIsCustom: Boolean(d.row.household.name?.trim()),
      });
      householdId = household.id;
      await createCrmContact(household.id, d.row.primary);
      if (d.row.spouse) {
        await createCrmContact(household.id, d.row.spouse);
      }
      created++;
    } catch (err) {
      // If the household row landed but a downstream contact insert
      // threw, roll the household back so we don't leave an empty
      // contactless household behind. Swallow rollback failures — we
      // still want to surface the original error to the caller.
      if (householdId) {
        try {
          await deleteCrmHousehold(householdId);
          orphansCleanedUp++;
        } catch {
          // best-effort cleanup; original error wins
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ rowIndex: i, messages: [msg] });
    }
  }

  await recordAudit({
    action: "crm.import.commit",
    resourceType: "crm_import",
    resourceId: `${firmId}:${Date.now()}`,
    firmId,
    metadata: {
      created,
      skipped,
      errorCount: errors.length,
      ...(orphansCleanedUp > 0 ? { orphansCleanedUp } : {}),
    },
  });

  return { created, skipped, errors };
}
