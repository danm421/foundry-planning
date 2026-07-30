import type { ExtractionResult } from "@/lib/extraction/types";
import { coerceYearRef } from "@/lib/milestones";
import {
  emptyImportPayload,
  type Annotated,
  type ImportPayload,
  type Provenance,
} from "./types";

export interface FileExtraction {
  fileId: string;
  result: ExtractionResult;
}

type RowWithMaybeProvenance = {
  __provenance?: { section: string; pageRange?: [number, number] };
};

/**
 * Merge per-file ExtractionResults into a single ImportPayload. Each row
 * is annotated with `__provenance` carrying the source file id (and
 * section/pageRange if multi-pass produced one) and an initial
 * `match: { kind: "new" }` so the UI can render the diff before the
 * matching pass runs. Singleton fields (primary, spouse) keep the first
 * non-empty value across files; conflicts are recorded in warnings.
 */
export function mergeExtractionResults(
  files: FileExtraction[],
): ImportPayload {
  const payload = emptyImportPayload();

  for (const { fileId, result } of files) {
    const fallbackProvenance = (section: string): Provenance => ({
      sourceFileId: fileId,
      section,
    });
    const annotateRow = <T extends object>(row: T, section: string): Annotated<T> => {
      const existing = (row as RowWithMaybeProvenance).__provenance;
      const stripped = { ...row } as T & RowWithMaybeProvenance;
      delete stripped.__provenance;
      const provenance: Provenance = existing
        ? {
            sourceFileId: fileId,
            section: existing.section,
            pageRange: existing.pageRange,
          }
        : fallbackProvenance(section);
      return { ...(stripped as T), __provenance: provenance, match: { kind: "new" } };
    };
    const sanitizeTimingRefs = <T extends { startYearRef?: unknown; endYearRef?: unknown }>(
      row: T,
    ): T => ({
      ...row,
      startYearRef: coerceYearRef(row.startYearRef),
      endYearRef: coerceYearRef(row.endYearRef),
    });

    for (const row of result.extracted.accounts) {
      payload.accounts.push(annotateRow(row, "accounts"));
    }
    for (const row of result.extracted.incomes) {
      payload.incomes.push(sanitizeTimingRefs(annotateRow(row, "incomes")));
    }
    for (const row of result.extracted.expenses) {
      payload.expenses.push(sanitizeTimingRefs(annotateRow(row, "expenses")));
    }
    for (const row of result.extracted.liabilities) {
      payload.liabilities.push(annotateRow(row, "liabilities"));
    }
    for (const row of result.extracted.entities) {
      payload.entities.push(annotateRow(row, "entities"));
    }
    for (const row of result.extracted.lifePolicies) {
      payload.lifePolicies.push(annotateRow(row, "lifePolicies"));
    }
    for (const row of result.extracted.wills) {
      payload.wills.push(annotateRow(row, "wills"));
    }
    // Savings rides the same copy-and-annotate path as its siblings. Without
    // this loop the section was inert on THREE of the four import paths —
    // `mergeExtractionResults` backs `run-matching.ts` and so the `/match`
    // route, which is Details→Import→Extract, the onboarding drawer, and Forge
    // mode "updating". Only Forge mode "new" (`mergeAcrossFiles`) copied them.
    // The extraction pass already runs and already returns
    // `extracted.savings`, so the rows were being thrown away after the Azure
    // call was paid for.
    //
    // `match: { kind: "new" }` from `annotateRow` is correct here: a savings
    // row resolves to an ACCOUNT by name at commit time, it is not matched
    // against an existing `savings_rules` row. `annotatePayload`
    // (match.ts) opens with `...payload` and never names savings, so these
    // rows survive `runMatchingPass` untouched.
    //
    // `?? []` — and NOT because "defensive is nice". This is R1's hazard one
    // layer up: `result` here is a PERSISTED `payloadJson.fileResults` entry
    // (match/route.ts reads the column and hands it straight in), and
    // `extracted.savings` was added to `ExtractionResult` by this branch alone
    // (`0038b216f`, not on main). So every fileResults row written before this
    // branch has no `savings` key, and the seven sibling loops above are safe
    // only because their sections predate any persisted row. Bare iteration
    // here would crash `/match` on exactly the pre-branch imports R1 exists to
    // protect. The type says `ExtractedSavings[]`, which is why nothing but a
    // runtime guard catches it.
    for (const row of result.extracted.savings ?? []) {
      payload.savings.push(annotateRow(row, "savings"));
    }

    const family = result.extracted.family;
    if (family) {
      if (family.primary && !payload.primary) {
        payload.primary = family.primary;
      } else if (family.primary && payload.primary) {
        const incomingName = `${family.primary.firstName} ${family.primary.lastName ?? ""}`.trim();
        const existingName = `${payload.primary.firstName} ${payload.primary.lastName ?? ""}`.trim();
        if (incomingName.toLowerCase() !== existingName.toLowerCase()) {
          payload.warnings.push(
            `Primary client conflict between files: "${existingName}" vs "${incomingName}". Keeping the first.`,
          );
        }
      }
      if (family.spouse && !payload.spouse) {
        payload.spouse = family.spouse;
      } else if (family.spouse && payload.spouse) {
        const incomingName = `${family.spouse.firstName} ${family.spouse.lastName ?? ""}`.trim();
        const existingName = `${payload.spouse.firstName} ${payload.spouse.lastName ?? ""}`.trim();
        if (incomingName.toLowerCase() !== existingName.toLowerCase()) {
          payload.warnings.push(
            `Spouse conflict between files: "${existingName}" vs "${incomingName}". Keeping the first.`,
          );
        }
      }
      for (const dep of family.dependents ?? []) {
        payload.dependents.push(annotateRow(dep, "family"));
      }
    }

    payload.warnings.push(...result.warnings);
  }

  return payload;
}
