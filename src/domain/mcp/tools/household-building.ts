// src/domain/mcp/tools/household-building.ts
//
// Building a household from Claude, one onboarding step at a time. A step is a
// fact finder import (../fact-finder-steps.ts) that Claude starts, fills from
// the statements it has read, reviews and saves — through the same cores the
// fact finder screen uses, so its rules hold unchanged: minted row ids,
// compare-and-set versions, matching, claim-once, the stale check and the
// all-or-nothing save. defineWriteTool gates every tool: the firm switch,
// billing, then edit access to the household — the access check for the save's
// lines whose cores don't make one.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withAiCallerOrg } from "@/lib/ai/resolve";
import { SAVE_STALE_MESSAGE, type ReviewRefusal } from "@/lib/fact-finder/api-types";
import { countLines, defaultTicks, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";
import { editFactFinder } from "@/lib/fact-finder/edit";
import { aiImportCheckFor, factFinderCreateCheckFor, factFinderGateFor, type FactFinderRefusal } from "@/lib/fact-finder/gate";
import { createFactFinderImport } from "@/lib/fact-finder/import-lifecycle";
import type { FFOp } from "@/lib/fact-finder/ops";
import { runLeftovers } from "@/lib/fact-finder/placement/leftovers-run";
import { missingFacts, missingFactsByStep } from "@/lib/fact-finder/missing-facts";
import { loadRecordBook } from "@/lib/fact-finder/records/book";
import { resolveBaseCaseScenarioId } from "@/lib/fact-finder/records/load";
import { reviewFactFinder } from "@/lib/fact-finder/review";
import { saveChangeSet } from "@/lib/fact-finder/save/save";
import { findSection, fixedLabelsOf } from "@/lib/fact-finder/schema";
import type { SourceStamp } from "@/lib/fact-finder/sources";
import { fixedRowId, locateRow, readFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { findLikelyDuplicateHousehold } from "@/lib/crm/duplicate-household";
import { ensurePlanImport } from "@/lib/imports/plan-builder-core";
import type { McpPrincipal } from "@/lib/mcp/principal";
import type { ImportRateLimitOp } from "@/lib/rate-limit";
import { changeListView } from "../change-list-view";
import { defineHouseholdWriteTool, defineTool, defineWriteTool, McpInputError, type McpTool } from "../define-tool";
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
 * sentence to act on. A step another advisor started reads as not found, so
 * nothing is disclosed, but is forbidden, so the denial audit shows the probe.
 */
function refusalError({ status, body: { error } }: FactFinderRefusal): Error {
  if (error === "Not found") return new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE);
  if (error === "Forbidden") return new McpForbiddenError(STEP_NOT_FOUND_MESSAGE);
  if (status === 404) return new McpInputError(STEP_NOT_FOUND_MESSAGE);
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

/**
 * A review refusal as the model reads it: the review's message, the draft's
 * version when the review changed it, and the rows to look at again — the ones
 * it names and every link still waiting on the advisor.
 */
function reviewRefusal({ error, factFinder, rows }: ReviewRefusal, state: FactFinderState): McpInputError {
  const needsDecision = rowsNeedingDecision(factFinder ?? state, rows);
  const details = {
    ...(factFinder && { version: factFinder.version }),
    ...(needsDecision.length > 0 && { needsDecision }),
  };
  return new McpInputError(error, Object.keys(details).length > 0 ? details : undefined);
}

const reviewFactFinderStep = defineWriteTool({
  name: "review_fact_finder_step",
  title: "Review a fact finder step",
  description:
    "Build a fact finder step's change list: the records saving it would create and update in the plan, each " +
    "field from its value on record (from) to the new one (to), and the lines that can't save with the reason. " +
    "Saves nothing to the plan. included marks what the save writes by default; a name or owner that would " +
    "replace one on record starts left out. Refused while a row's link to an existing record waits on the " +
    "advisor; the refusal lists those rows as needsDecision. changeSetVersion is what save_fact_finder_step " +
    "takes, and the draft's version for a later fill.",
  inputSchema: z.object({ clientId: clientIdArg, importId: importIdArg }),
  handler: async ({ clientId, importId }, { principal }) => {
    const gate = await openStep(principal, clientId, importId, "match");
    const state = readFactFinderState(gate.payloadJson);
    // The review's AI step runs in the firm's tenant: the verified token's org, as there's no Clerk session.
    const outcome = await withAiCallerOrg(principal.orgId, () =>
      reviewFactFinder({ importId, clientId, firmId: gate.firmId }, state, {
        now: new Date(),
        actorId: principal.userId,
        runLeftovers,
      }),
    );
    if (!outcome.ok) throw reviewRefusal(outcome.body, state);
    return changeListView(outcome.changeSet, defaultTicks(outcome.changeSet));
  },
  auditMetadata: (args, result) => ({ importId: args.importId, changeSetVersion: result.changeSetVersion }),
});

type LineChoice = { lineId: string; key?: string };

/**
 * The advisor's ticks: the review's defaults, less `leaveOut` (a whole line,
 * or one field), plus `include`. R27: a line or field the change list doesn't
 * have refuses, so a mistyped id never saves a line the advisor turned down.
 */
function approvedTicks(changeSet: ChangeSet, leaveOut: readonly LineChoice[], include: readonly Required<LineChoice>[]): ChangeTicks {
  const ticks = defaultTicks(changeSet);
  const lineOf = ({ lineId, key }: LineChoice) => {
    const line = changeSet.lines.find((l) => l.id === lineId);
    if (!line) throw new McpInputError(`Line ${lineId} isn't in this change list. Use a lineId review_fact_finder_step returned.`);
    if (key !== undefined && !line.fields.some((f) => f.key === key)) {
      throw new McpInputError(`Line ${lineId} has no field "${key}".`);
    }
    return line;
  };
  for (const choice of leaveOut) {
    lineOf(choice);
    // A line that can't save has no ticks: it is left out already.
    const lineTicks = ticks[choice.lineId] ?? {};
    for (const key of choice.key === undefined ? Object.keys(lineTicks) : [choice.key]) lineTicks[key] = false;
  }
  for (const choice of include) {
    const line = lineOf(choice);
    const lineTicks = ticks[choice.lineId];
    if (!lineTicks) throw new McpInputError(`${line.label} can't save: ${line.blocked?.reason ?? "it changes nothing."}`);
    lineTicks[choice.key] = true;
  }
  return ticks;
}

const saveFactFinderStep = defineWriteTool({
  name: "save_fact_finder_step",
  title: "Save a fact finder step",
  description:
    "Save a reviewed fact finder step to the plan: the included fields of the change list " +
    "review_fact_finder_step returned, less leaveOut, plus include. All or nothing: a line the plan refuses, or " +
    "a draft or record changed since the review, saves nothing, and the refusal names the line (lineId). Closes " +
    "the step. Returns the records created and updated, and how many lines were left out, including lines that " +
    "can't save.",
  inputSchema: z.object({
    clientId: clientIdArg,
    importId: importIdArg,
    changeSetVersion: z.number().int().min(0).describe("The changeSetVersion review_fact_finder_step returned."),
    leaveOut: z
      .array(z.object({ lineId: z.string(), key: z.string().optional() }))
      .optional()
      .describe("Lines the advisor left out; with key, one field of the line."),
    include: z
      .array(z.object({ lineId: z.string(), key: z.string() }))
      .optional()
      .describe("Fields not included by default that the advisor wants saved."),
  }),
  page: "netWorth",
  handler: async ({ clientId, importId, changeSetVersion, leaveOut = [], include = [] }, { principal }) => {
    const gate = await openStep(principal, clientId, importId, "commit");
    const { changeSet } = readFactFinderState(gate.payloadJson);
    // The ticks are the list's: one reviewed again since (or never) is the save's own stale refusal.
    if (!changeSet || changeSet.builtAtVersion !== changeSetVersion) throw new McpInputError(SAVE_STALE_MESSAGE);
    const outcome = await saveChangeSet({
      scope: { importId, clientId, firmId: gate.firmId },
      actorId: principal.userId,
      principal,
      changeSetVersion,
      ticks: approvedTicks(changeSet, leaveOut, include),
    });
    if (!outcome.ok) throw new McpInputError(outcome.error, outcome.lineId !== undefined ? { lineId: outcome.lineId } : undefined);
    const { saved = [], leftOut = [] } = outcome.factFinder.closed ?? {};
    const savedIds = new Set(saved.map((s) => s.lineId));
    const { creates, updates } = countLines(changeSet.lines.filter((l) => savedIds.has(l.id)));
    return { saved: { create: creates, update: updates }, leftOut: leftOut.length };
  },
  auditMetadata: (args) => ({ importId: args.importId, changeSetVersion: args.changeSetVersion }),
});

const LIFE_EXPECTANCY = 95;
const dateOfBirth = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const retirementAge = z.number().int().min(40).max(85);
const filingStatus = z.enum(["single", "married_joint", "married_separate", "head_of_household"]);
const person = z.object({ firstName: z.string().min(1), lastName: z.string().min(1), dateOfBirth });

/** The core's refusals written for a person; anything else is not model-safe. */
const PLAN_REFUSAL = /retirement age is required|already has a plan|needs a date of birth/;

const createHousehold = defineHouseholdWriteTool({
  name: "create_household",
  title: "Create a household",
  description:
    "Create a household with its plan, or start the plan of an existing prospect household, and open step 0 of " +
    "its fact finder as a draft. Give household (a new household) or householdId with prospect (a household " +
    "that has no plan yet), not both. A new household is checked first for a likely duplicate: a household you " +
    "can see whose primary contact has the same name and date of birth. If one exists nothing is created and " +
    "likelyDuplicate is returned; pass its householdId as differentFromHouseholdId to create anyway. Life " +
    "expectancy is set to 95 for everyone. Returns clientId, householdId and importId for " +
    "fill_fact_finder_step.",
  inputSchema: z
    .object({
      householdId: z.string().optional().describe("An existing household with no plan yet. Needs prospect."),
      prospect: z
        .object({
          filingStatus,
          retirementAge: retirementAge.describe("The primary person's retirement age."),
          spouseRetirementAge: retirementAge.optional().describe("Required when the household has a spouse."),
        })
        .optional(),
      household: z
        .object({
          name: z.string().min(1).describe("The household's name, e.g. \"Smith Household\"."),
          state: z.string().optional().describe("USPS two-letter state code."),
          primary: person.extend({ retirementAge }),
          spouse: person.extend({ retirementAge }).optional(),
          filingStatus,
        })
        .optional(),
      differentFromHouseholdId: z
        .string()
        .optional()
        .describe("The likelyDuplicate householdId, when it is a different family."),
    })
    .refine((a) => (a.householdId === undefined) !== (a.household === undefined), {
      message: "Give either household or householdId, not both.",
    })
    .refine((a) => (a.householdId === undefined) === (a.prospect === undefined), {
      message: "householdId goes with prospect, and prospect with householdId.",
    }),
  handler: async (args, { principal, firmId }) => {
    // Before anything is created: a refusal leaves no household, client or draft behind.
    const entitled = await aiImportCheckFor(principal);
    if (!entitled.ok) throw refusalError(entitled);
    const base = { firmId, actorUserId: principal.userId, principal, label: "Claude: Household" };

    if (args.householdId !== undefined && args.prospect) {
      const { filingStatus: status, retirementAge: age, spouseRetirementAge: spouseAge } = args.prospect;
      try {
        const created = await ensurePlanImport({
          ...base,
          mode: "prospect",
          prospect: {
            householdId: args.householdId,
            filingStatus: status,
            retirementAge: age,
            lifeExpectancy: LIFE_EXPECTANCY,
            ...(spouseAge !== undefined && { spouseRetirementAge: spouseAge, spouseLifeExpectancy: LIFE_EXPECTANCY }),
          },
        });
        return { created: true as const, clientId: created.clientId, householdId: args.householdId, importId: created.importId, nextStep: "household" as const };
      } catch (err) {
        if (err instanceof Error && PLAN_REFUSAL.test(err.message)) throw new McpInputError(err.message);
        throw err;
      }
    }

    const h = args.household!;
    const duplicate = await findLikelyDuplicateHousehold(principal, h.primary);
    if (duplicate && duplicate.householdId !== args.differentFromHouseholdId) {
      return {
        created: false as const,
        likelyDuplicate: {
          householdId: duplicate.householdId,
          name: duplicate.name,
          hasPlan: duplicate.clientId !== null,
          clientId: duplicate.clientId,
        },
      };
    }
    const created = await ensurePlanImport({
      ...base,
      mode: "new",
      newHousehold: {
        householdName: h.name,
        state: h.state,
        primary: { firstName: h.primary.firstName, lastName: h.primary.lastName, dateOfBirth: h.primary.dateOfBirth },
        ...(h.spouse && {
          spouse: { firstName: h.spouse.firstName, lastName: h.spouse.lastName, dateOfBirth: h.spouse.dateOfBirth },
        }),
        filingStatus: h.filingStatus,
        retirementAge: h.primary.retirementAge,
        lifeExpectancy: LIFE_EXPECTANCY,
        ...(h.spouse && { spouseRetirementAge: h.spouse.retirementAge, spouseLifeExpectancy: LIFE_EXPECTANCY }),
      },
    });
    return { created: true as const, clientId: created.clientId, householdId: created.householdId!, importId: created.importId, nextStep: "household" as const };
  },
  auditMetadata: (args, result) => ({
    mode: args.household ? "new" : "prospect",
    householdId: "householdId" in result ? result.householdId : (args.householdId ?? null),
    ...("importId" in result && { importId: result.importId }),
  }),
});

const getMissingFacts = defineTool({
  name: "get_missing_facts",
  title: "What a plan still lacks",
  description:
    "List the facts a household's base plan still lacks, such as a missing date of birth, salary or property tax. " +
    "Returns missing (step, record, label and what is missing) and byStep, the count of gaps in every onboarding " +
    "step; step narrows missing to one step only.",
  inputSchema: z.object({
    clientId: clientIdArg,
    step: z.enum(FACT_FINDER_STEP_IDS).optional().describe("Only list gaps from this onboarding step."),
  }),
  page: "netWorth",
  handler: async ({ clientId, step }, { firmId }) => {
    const scenarioId = await resolveBaseCaseScenarioId(clientId);
    if (!scenarioId) throw new McpInputError(NO_BASE_PLAN_MESSAGE);
    const book = await loadRecordBook(clientId, firmId, scenarioId);
    const all = missingFacts(book, { currentYear: new Date().getFullYear() });
    return { missing: step ? all.filter((m) => m.step === step) : all, byStep: missingFactsByStep(all) };
  },
});

export const householdBuildingTools: McpTool[] = [
  createHousehold,
  startFactFinderStep,
  fillFactFinderStep,
  reviewFactFinderStep,
  saveFactFinderStep,
  getMissingFacts,
];
