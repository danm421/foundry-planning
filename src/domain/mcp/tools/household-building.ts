// src/domain/mcp/tools/household-building.ts
//
// Building a household from Claude, one onboarding step at a time. A step is a
// fact finder import (../fact-finder-steps.ts) that Claude starts, fills from
// the statements it has read, reviews and saves — through the same cores the
// fact finder screen uses, so its rules hold unchanged: minted row ids,
// compare-and-set versions, matching, claim-once. defineWriteTool gates every
// tool: the firm switch, billing, then edit access to the household.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { editFactFinder } from "@/lib/fact-finder/edit";
import { factFinderCreateCheckFor, factFinderGateFor, type FactFinderRefusal } from "@/lib/fact-finder/gate";
import { createFactFinderImport } from "@/lib/fact-finder/import-lifecycle";
import type { FFOp } from "@/lib/fact-finder/ops";
import { loadRecordBook } from "@/lib/fact-finder/records/book";
import { resolveBaseCaseScenarioId } from "@/lib/fact-finder/records/load";
import { findSection, fixedLabelsOf } from "@/lib/fact-finder/schema";
import type { SourceStamp } from "@/lib/fact-finder/sources";
import { fixedRowId, locateRow, readFactFinderState } from "@/lib/fact-finder/state";
import type { McpPrincipal } from "@/lib/mcp/principal";
import type { ImportRateLimitOp } from "@/lib/rate-limit";
import { defineWriteTool, McpInputError, type McpTool } from "../define-tool";
import { CLIENT_UNREADABLE_MESSAGE, McpForbiddenError } from "../guards";
import {
  describeStep,
  draftRows,
  FACT_FINDER_STEP_IDS,
  factFinderStep,
  rowsNeedingDecision,
} from "../fact-finder-steps";

const NO_BASE_PLAN_MESSAGE = "This household has no base plan yet.";
const STEP_CONFLICT_MESSAGE =
  "Someone else changed this step. Here is the current version; re-apply your changes to it.";
const STEP_NOT_FOUND_MESSAGE = "That fact finder step wasn't found. Use the importId start_fact_finder_step returned.";
const MAX_FILL_ROWS = 50;

const clientIdArg = z
  .string()
  .describe(
    "Planning client id from search_clients (the clientId field, present only when " +
      "hasPlan is true). NOT a CRM household id.",
  );
const importIdArg = z.string().describe("The importId start_fact_finder_step returned.");

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Where a value came from: a statement Claude read, which Foundry never holds. */
const cellSources = z
  .record(
    z.string(),
    z.object({
      document: z.string().min(1).max(200),
      page: z.number().int().positive().optional(),
      // No max: stampSources keeps the first 200 characters.
      quote: z.string().optional(),
    }),
  )
  .optional()
  .describe("Per column id: the document the value came from, its page and a short quote.");

const fillRow = z.object({
  sectionId: z.string(),
  rowId: z.string().optional().describe("An existing draft row. Omit with fixedRow for a new row."),
  fixedRow: z.string().optional().describe("A fixed row's label from the section's fixedRows, e.g. \"Client\"."),
  cells: z.record(z.string(), cellValue).describe("Column id to value. null clears a cell."),
  link: z
    .union([z.object({ recordId: z.string() }), z.literal("new")])
    .optional()
    .describe("Links the row to an existing record, or marks it \"new\" — how a needsDecision row is answered."),
  sources: cellSources,
});
type FillRow = z.infer<typeof fillRow>;

/**
 * A fact finder refusal as the model reads it. Access refusals (a missing or
 * shared client, view-only access, no AI import) are forbidden; the rest are a
 * sentence to act on. A step another advisor started reads as not found.
 */
function refusalError({ status, body: { error } }: FactFinderRefusal): Error {
  if (error === "Not found") return new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE);
  if (status === 404 || error === "Forbidden") return new McpInputError(STEP_NOT_FOUND_MESSAGE);
  if (error === "ai_import_not_entitled") return new McpForbiddenError("AI features aren't enabled for this firm.");
  if (status === 403) return new McpForbiddenError(error);
  return new McpInputError(error);
}

/** The fact finder gate on the principal, for a step that exists. */
async function openStep(principal: McpPrincipal, clientId: string, importId: string, op: ImportRateLimitOp) {
  const gate = await factFinderGateFor(principal, clientId, importId, op);
  if (!gate.ok) throw refusalError(gate);
  return gate;
}

/** The draft row a fill names: its rowId, its fixed row, or null for a new row. */
function targetRowId(row: FillRow): string | null {
  if (row.rowId !== undefined && row.fixedRow !== undefined) {
    throw new McpInputError("Give a row a rowId or a fixedRow, not both.");
  }
  if (row.fixedRow === undefined) return row.rowId ?? null;
  const section = findSection(row.sectionId);
  if (section && !fixedLabelsOf(section).includes(row.fixedRow)) {
    throw new McpInputError(`Section ${row.sectionId} has no fixed row "${row.fixedRow}"; use one of its fixedRows.`);
  }
  return fixedRowId(row.sectionId, row.fixedRow);
}

/** One fill row as the fact finder's ops, and the sources for the cells it writes. */
function rowOps(row: FillRow): { ops: FFOp[]; stamps: SourceStamp[] } {
  const { sectionId, cells } = row;
  const existing = targetRowId(row);
  const rowId = existing ?? randomUUID();
  const ops: FFOp[] = [];
  if (existing === null) {
    const filled = Object.fromEntries(Object.entries(cells).filter(([, v]) => v !== null));
    ops.push({ op: "addRow", sectionId, rowId, cells: filled });
  } else {
    for (const [columnId, value] of Object.entries(cells)) {
      ops.push(
        value === null
          ? { op: "clearCell", sectionId, rowId, columnId }
          : { op: "setCell", sectionId, rowId, columnId, value },
      );
    }
  }
  if (row.link !== undefined) {
    ops.push({
      op: "setLink",
      sectionId,
      rowId,
      link: row.link === "new" ? { kind: "new" } : { kind: "existing", recordId: row.link.recordId },
    });
  }
  // R17: a source only for a value this row writes — never one it clears or leaves alone.
  const stamps = Object.entries(row.sources ?? {})
    .filter(([columnId]) => cells[columnId] !== undefined && cells[columnId] !== null)
    .map(([columnId, { document, page, quote }]): SourceStamp => ({
      sectionId,
      rowId,
      columnId,
      documentName: document,
      ...(page !== undefined ? { page } : {}),
      ...(quote !== undefined ? { quote } : {}),
    }));
  return { ops, stamps };
}

const startFactFinderStep = defineWriteTool({
  name: "start_fact_finder_step",
  title: "Start a fact finder step",
  description:
    "Open one onboarding step of a household as a new fact finder draft in Foundry. Returns importId and version " +
    "for fill_fact_finder_step; the step's sections with their columns, options and fixed rows; guidance on what " +
    "the fields mean; and the household's existing records the rows are matched against (seeded: true marks a " +
    "placeholder every new plan starts with). Nothing reaches the plan until the step is saved.",
  inputSchema: z.object({
    clientId: clientIdArg,
    step: z.enum(FACT_FINDER_STEP_IDS).describe("The onboarding step, listed in the usual order."),
  }),
  page: "netWorth",
  handler: async ({ clientId, step }, { principal, firmId }) => {
    // The gate's client and entitlement refusals, before a draft exists to refuse later.
    const check = await factFinderCreateCheckFor(principal, clientId);
    if (!check.ok) throw refusalError(check);
    const scenarioId = await resolveBaseCaseScenarioId(clientId);
    if (!scenarioId) throw new McpInputError(NO_BASE_PLAN_MESSAGE);
    // The book first: a failed read leaves no draft behind.
    const book = await loadRecordBook(clientId, firmId, scenarioId);
    const imp = await createFactFinderImport({
      clientId,
      firmId,
      userId: principal.userId,
      scenarioId,
      mode: "updating",
      notes: `Claude: ${factFinderStep(step).label}`,
      audit: { via: "claude" },
    });
    const state = readFactFinderState(imp.payloadJson);
    return { importId: imp.id, version: state.version, ...describeStep(step, state, book) };
  },
  auditMetadata: (args, result) => ({ importId: result.importId, step: args.step }),
});

const fillFactFinderStep = defineWriteTool({
  name: "fill_fact_finder_step",
  title: "Fill a fact finder step",
  description:
    "Write rows into a fact finder step's draft. A row names its section and either rowId (a draft row), fixedRow " +
    "(a fixed row such as \"Client\") or neither (a new row). Values are checked against each column's kind and " +
    "options. Nothing is written when baseVersion is not the draft's current version. Returns the new version, " +
    "the rows of the sections touched, and needsDecision: rows matched to an existing record too loosely to link " +
    "on their own, each with its candidates.",
  inputSchema: z.object({
    clientId: clientIdArg,
    importId: importIdArg,
    baseVersion: z.number().int().min(0).describe("The version the last step call returned."),
    rows: z.array(fillRow).min(1).max(MAX_FILL_ROWS),
    removeRowIds: z.array(z.string()).max(MAX_FILL_ROWS).optional().describe("Draft rows to remove."),
  }),
  handler: async ({ clientId, importId, baseVersion, rows, removeRowIds }, { principal }) => {
    const gate = await openStep(principal, clientId, importId, "edit");
    const current = readFactFinderState(gate.payloadJson);

    const ops: FFOp[] = [];
    const stamps: SourceStamp[] = [];
    const touched = new Set<string>();
    for (const row of rows) {
      const built = rowOps(row);
      ops.push(...built.ops);
      stamps.push(...built.stamps);
      touched.add(row.sectionId);
    }
    for (const rowId of removeRowIds ?? []) {
      const at = locateRow(current, rowId);
      if (!at) throw new McpInputError(`Row ${rowId} isn't in this draft.`);
      ops.push({ op: "removeRow", sectionId: at.sectionId, rowId, reason: "Removed by Claude" });
      touched.add(at.sectionId);
    }
    if (ops.length === 0) throw new McpInputError("Nothing to write: give a row cells or a link.");

    const scope = { importId, clientId, firmId: gate.firmId };
    const outcome = await editFactFinder(scope, current, baseVersion, ops, {
      by: "chat",
      actorId: principal.userId,
      stamps,
    });
    if (!outcome.ok) {
      if (outcome.status !== 409) throw new McpInputError(outcome.error);
      const fresh = outcome.factFinder;
      throw new McpInputError(
        STEP_CONFLICT_MESSAGE,
        fresh && { version: fresh.version, rows: draftRows(fresh, touched) },
      );
    }
    const { state } = outcome;
    return { version: state.version, rows: draftRows(state, touched), needsDecision: rowsNeedingDecision(state) };
  },
  auditMetadata: (args) => ({ importId: args.importId, rowCount: args.rows.length }),
});

export const householdBuildingTools: McpTool[] = [startFactFinderStep, fillFactFinderStep];
