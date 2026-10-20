// src/domain/mcp/tools/household-building.ts
//
// Building a household from Claude, one onboarding step at a time. A step is a
// fact finder import (../fact-finder-steps.ts) that Claude starts, fills from
// the statements it has read, reviews and saves — through the same cores the
// fact finder screen uses, so its rules hold unchanged: minted row ids,
// compare-and-set versions, matching, claim-once, the stale check and the
// all-or-nothing save. A single edit runs the same cores on a one-row import in
// one call; plan assumptions go straight to the plan settings core.
// defineWriteTool gates every tool: the firm switch, billing, then edit access
// to the household — the access check for the save's lines whose cores don't
// make one.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accounts, expenses, filingStatusEnum, incomes, liabilities, savingsRules } from "@/db/schema";
import { withAiCallerOrg } from "@/lib/ai/resolve";
import { SAVE_STALE_MESSAGE, type ReviewRefusal } from "@/lib/fact-finder/api-types";
import { countLines, defaultTicks, type ChangeLine, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";
import { editFactFinder } from "@/lib/fact-finder/edit";
import { aiImportCheckFor, factFinderCreateCheckFor, factFinderGateFor, type FactFinderRefusal } from "@/lib/fact-finder/gate";
import { createFactFinderImport, discardImport } from "@/lib/fact-finder/import-lifecycle";
import type { FFOp } from "@/lib/fact-finder/ops";
import type { FactFinderScope } from "@/lib/fact-finder/persist";
import { runLeftovers } from "@/lib/fact-finder/placement/leftovers-run";
import type { RecordBook } from "@/lib/fact-finder/placement/types";
import { missingFacts, missingFactsByStep } from "@/lib/fact-finder/missing-facts";
import { loadRecordBook } from "@/lib/fact-finder/records/book";
import { resolveBaseCaseScenarioId } from "@/lib/fact-finder/records/load";
import { reviewFactFinder } from "@/lib/fact-finder/review";
import { saveChangeSet } from "@/lib/fact-finder/save/save";
import { FACT_FINDER_SECTIONS, findSection, fixedLabelsOf, isListLike, type FFSection } from "@/lib/fact-finder/schema";
import type { SourceStamp } from "@/lib/fact-finder/sources";
import { factFinderImportSeed, fixedRowId, locateRow, readFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { deleteAccountForClient } from "@/lib/clients/accounts-writes";
import type { EntityWriteResult } from "@/lib/clients/entity-write-result";
import { deleteExpenseForClient } from "@/lib/clients/expenses-writes";
import { deleteIncomeForClient } from "@/lib/clients/incomes-writes";
import { deleteLiabilityForClient } from "@/lib/clients/liabilities-writes";
import { deleteSavingsRuleForClient } from "@/lib/clients/savings-rules-writes";
import { updatePlanSettingsForClient } from "@/lib/clients/plan-settings-writes";
import { findLikelyDuplicateHousehold } from "@/lib/crm/duplicate-household";
import { ensurePlanImport, PlanImportRefusal, type EnsurePlanImportResult } from "@/lib/imports/plan-builder-core";
import { foundryUrl } from "@/lib/mcp/foundry-url";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { ASSUMED_LIFE_EXPECTANCY } from "@/lib/plan-horizon";
import type { ImportRateLimitOp } from "@/lib/rate-limit";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { isUSPSStateCode } from "@/lib/usps-states";
import { changeListView } from "../change-list-view";
import { defineHouseholdWriteTool, defineTool, defineWriteTool, McpInputError, type McpTool } from "../define-tool";
import { CLIENT_UNREADABLE_MESSAGE, McpForbiddenError } from "../guards";
import {
  describeStep,
  draftRows,
  FACT_FINDER_STEP_IDS,
  factFinderStep,
  rowsNeedingDecision,
  type FactFinderStepId,
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
  cells: z.record(z.string(), cellValue).describe("Column id to value; a percent column takes 6.5 for 6.5%. null clears a cell."),
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

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(", ");

/** A section's fixed rows, for a refusal that names them. */
function fixedRowsNote(section: FFSection): string {
  const labels = fixedLabelsOf(section);
  return labels.length > 0 ? `Its fixed rows: ${quoted(labels)}.` : "It has no fixed rows.";
}

/** The draft row a fill names: its rowId, its fixed row, or null for a new row. */
function targetRowId(row: FillRow): string | null {
  if (row.rowId !== undefined && row.fixedRow !== undefined) {
    throw new McpInputError("Give a row a rowId or a fixedRow, not both.");
  }
  if (row.fixedRow === undefined) return row.rowId ?? null;
  const section = findSection(row.sectionId);
  if (section && !fixedLabelsOf(section).includes(row.fixedRow)) {
    throw new McpInputError(`Section ${row.sectionId} has no fixed row "${row.fixedRow}". ${fixedRowsNote(section)}`);
  }
  return fixedRowId(row.sectionId, row.fixedRow);
}

/** One fill row as the fact finder's ops on its row, and the sources for the cells it writes. */
function rowOps(row: FillRow): { rowId: string; ops: FFOp[]; stamps: SourceStamp[] } {
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
  return { rowId, ops, stamps };
}

/**
 * The base case a new draft goes on, after the import gate's client and
 * entitlement refusals — so a refusal leaves no draft behind (R23).
 */
async function draftBaseCase(principal: McpPrincipal, clientId: string): Promise<string> {
  const check = await factFinderCreateCheckFor(principal, clientId);
  if (!check.ok) throw refusalError(check);
  const scenarioId = await resolveBaseCaseScenarioId(clientId);
  if (!scenarioId) throw new McpInputError(NO_BASE_PLAN_MESSAGE);
  return scenarioId;
}

/** A new updating draft on the base case, the principal's own. */
function createDraft(principal: McpPrincipal, clientId: string, firmId: string, scenarioId: string, notes: string) {
  return createFactFinderImport({
    clientId,
    firmId,
    userId: principal.userId,
    scenarioId,
    mode: "updating",
    notes,
    audit: { via: "claude" },
  });
}

/** What a new draft's first fill needs: its id and version, and the step as describeStep shows it. */
function newStepView(stepId: FactFinderStepId, importId: string, payloadJson: unknown, book: RecordBook) {
  const state = readFactFinderState(payloadJson);
  return { importId, version: state.version, ...describeStep(stepId, state, book) };
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
    const scenarioId = await draftBaseCase(principal, clientId);
    // The book first: a failed read leaves no draft behind.
    const book = await loadRecordBook(clientId, firmId, scenarioId);
    const imp = await createDraft(principal, clientId, firmId, scenarioId, `Claude: ${factFinderStep(step).label}`);
    return newStepView(step, imp.id, imp.payloadJson, book);
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

/** The draft's change list as the review builds and stores it, or its refusal. `leftovers` null: no AI step. */
async function reviewDraft(
  scope: FactFinderScope,
  state: FactFinderState,
  actorId: string,
  leftovers: typeof runLeftovers | null,
): Promise<ChangeSet> {
  const outcome = await reviewFactFinder(scope, state, { now: new Date(), actorId, runLeftovers: leftovers });
  if (!outcome.ok) throw reviewRefusal(outcome.body, state);
  return outcome.changeSet;
}

const reviewFactFinderStep = defineWriteTool({
  name: "review_fact_finder_step",
  title: "Review a fact finder step",
  description:
    "Build a fact finder step's change list: the records saving it would create and update in the plan, each " +
    "field from its value on record (from) to the new one (to), and the lines that can't save with the reason. " +
    "Saves nothing to the plan. included marks what the save writes by default, and leftOut why it would leave " +
    "a line out; a name or owner that would replace one on record starts left out. Refused while a row's link " +
    "to an existing record waits on the advisor; the refusal lists those rows as needsDecision. " +
    "changeSetVersion is what save_fact_finder_step takes, and the draft's version for a later fill.",
  inputSchema: z.object({ clientId: clientIdArg, importId: importIdArg }),
  handler: async ({ clientId, importId }, { principal }) => {
    const gate = await openStep(principal, clientId, importId, "match");
    const state = readFactFinderState(gate.payloadJson);
    // The review's AI step runs in the firm's tenant: the verified token's org, as there's no Clerk session.
    const changeSet = await withAiCallerOrg(principal.orgId, () =>
      reviewDraft({ importId, clientId, firmId: gate.firmId }, state, principal.userId, runLeftovers),
    );
    return changeListView(changeSet, defaultTicks(changeSet));
  },
  auditMetadata: (args, result) => ({ importId: args.importId, changeSetVersion: result.changeSetVersion }),
});

type LineChoice = { lineId: string; key?: string };

/** Why a line saves nothing: the review's reason, or no change at all. */
const cannotSave = (line: ChangeLine) => `${line.label} can't save: ${line.blocked?.reason ?? "it changes nothing."}`;

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
    if (!lineTicks) throw new McpInputError(cannotSave(line));
    lineTicks[choice.key] = true;
  }
  return ticks;
}

/**
 * The reviewed list saved as the principal, the import closed: the lines it
 * saved, and each line it left out with the reason. All or nothing — a
 * refusal writes nothing and names its line.
 */
async function saveDraft(
  scope: FactFinderScope,
  principal: McpPrincipal,
  changeSet: ChangeSet,
  ticks: ChangeTicks,
): Promise<{ savedLines: ChangeLine[]; leftOut: { lineId: string; label: string; reason: string }[] }> {
  const outcome = await saveChangeSet({ scope, actorId: principal.userId, principal, changeSetVersion: changeSet.builtAtVersion, ticks });
  if (!outcome.ok) throw new McpInputError(outcome.error, outcome.lineId !== undefined ? { lineId: outcome.lineId } : undefined);
  const { saved = [], leftOut = [] } = outcome.factFinder.closed ?? {};
  const savedIds = new Set(saved.map((s) => s.lineId));
  return {
    savedLines: changeSet.lines.filter((l) => savedIds.has(l.id)),
    leftOut: leftOut.map(({ lineId, label, reason }) => ({ lineId, label, reason })),
  };
}

const saveFactFinderStep = defineWriteTool({
  name: "save_fact_finder_step",
  title: "Save a fact finder step",
  description:
    "Save a reviewed fact finder step to the plan: the included fields of the change list " +
    "review_fact_finder_step returned, less leaveOut, plus include. All or nothing: a line the plan refuses, or " +
    "a draft or record changed since the review, saves nothing, and the refusal names the line (lineId). Closes " +
    "the step. Returns the records created and updated, and each line left out, with the reason.",
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
    const scope = { importId, clientId, firmId: gate.firmId };
    const { savedLines, leftOut } = await saveDraft(scope, principal, changeSet, approvedTicks(changeSet, leaveOut, include));
    const { creates, updates } = countLines(savedLines);
    return { saved: { create: creates, update: updates }, leftOut };
  },
  auditMetadata: (args) => ({ importId: args.importId, changeSetVersion: args.changeSetVersion }),
});

const dateOfBirth = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const retirementAge = z.number().int().min(40).max(85);
const filingStatus = z.enum(filingStatusEnum.enumValues);
const person = z.object({ firstName: z.string().min(1), lastName: z.string().min(1), dateOfBirth });

/**
 * The household `ensurePlanImport` just created a plan for, with its step 0
 * draft as start_fact_finder_step shows a step — so Claude fills that draft
 * rather than opening a second one.
 */
async function householdCreated(created: EnsurePlanImportResult, householdId: string, firmId: string) {
  const book = await loadRecordBook(created.clientId, firmId, created.scenarioId);
  // The core's draft is the fact finder's seed, not edited yet.
  const step0 = newStepView("household", created.importId, factFinderImportSeed().payloadJson, book);
  return {
    created: true as const,
    clientId: created.clientId,
    householdId,
    nextStep: "household" as const,
    ...step0,
    foundryUrl: foundryUrl(created.clientId, "netWorth"),
  };
}

const createHousehold = defineHouseholdWriteTool({
  name: "create_household",
  title: "Create a household",
  description:
    "Create a household with its plan, or start the plan of an existing prospect household, and open step 0 of " +
    "its fact finder as a draft. Give household (a new household) or householdId with prospect (a household " +
    "that has no plan yet), not both. A new household is checked first for a likely duplicate: a household you " +
    "can see whose primary contact has the same name and date of birth. If one exists nothing is created and " +
    "likelyDuplicate is returned; pass its householdId as differentFromHouseholdId to create anyway. Life " +
    "expectancy is set to 95 for everyone. Returns clientId, householdId and step 0's draft as " +
    "start_fact_finder_step returns it; don't start step 0 again.",
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
    const state = args.household?.state;
    // R47: the core drops a state it can't hold, so Claude would believe it was set.
    if (state !== undefined && !isUSPSStateCode(state)) {
      throw new McpInputError(`"${state}" isn't a USPS state code. Give the two-letter code, e.g. "CO".`);
    }
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
            lifeExpectancy: ASSUMED_LIFE_EXPECTANCY,
            ...(spouseAge !== undefined && { spouseRetirementAge: spouseAge, spouseLifeExpectancy: ASSUMED_LIFE_EXPECTANCY }),
          },
        });
        return await householdCreated(created, args.householdId, firmId);
      } catch (err) {
        // The core's refusals written for a person; anything else is not model-safe.
        if (err instanceof PlanImportRefusal) throw new McpInputError(err.message);
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
        lifeExpectancy: ASSUMED_LIFE_EXPECTANCY,
        ...(h.spouse && { spouseRetirementAge: h.spouse.retirementAge, spouseLifeExpectancy: ASSUMED_LIFE_EXPECTANCY }),
      },
    });
    return householdCreated(created, created.householdId!, firmId);
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

const NOTHING_TO_CHANGE_MESSAGE = "Nothing to change — the plan already has these values.";
const MAX_EDIT_CELLS = 30;

/**
 * A single edit's section and columns, before any draft exists: an unknown one
 * is refused with the ids it could be, so Claude learns them without opening a
 * draft (R39). A fixed row's label is targetRowId's to check.
 */
function checkEdit(sectionId: string, fixedRow: string | undefined, cells: Record<string, unknown>): FFSection {
  const section = findSection(sectionId);
  if (!section) {
    throw new McpInputError(`There's no fact finder section "${sectionId}". Sections: ${FACT_FINDER_SECTIONS.map((s) => s.id).join(", ")}.`);
  }
  if (fixedRow === undefined && !isListLike(section)) throw new McpInputError(`Section ${sectionId} needs a fixedRow. ${fixedRowsNote(section)}`);
  const columns = section.columns.map((c) => c.id);
  const unknown = Object.keys(cells).filter((id) => !columns.includes(id));
  if (unknown.length > 0) {
    throw new McpInputError(`Section ${sectionId} has no column ${quoted(unknown)}. Its columns: ${columns.join(", ")}.`);
  }
  return section;
}

/**
 * The review's ticks, plus every field the edit's own cells set — a name or
 * owner on record included, which the review leaves out by default.
 */
function editTicks(changeSet: ChangeSet, rowId: string, cells: Record<string, unknown>): ChangeTicks {
  const ticks = defaultTicks(changeSet);
  for (const line of changeSet.lines) {
    for (const field of line.fields) {
      const set = field.from.some((c) => c.rowId === rowId && Object.hasOwn(cells, c.columnId));
      if (set && ticks[line.id]) ticks[line.id][field.key] = true;
    }
  }
  return ticks;
}

/**
 * `run` on a draft this call created; when it throws, that draft is discarded
 * first. Only ever this call's own import (discardImport doesn't check who
 * created one), and never a saved one — discardImport leaves those as they are.
 */
async function orDiscard<T>(scope: FactFinderScope, actorId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    await discardImport(scope, actorId);
    throw err;
  }
}

const updatePlanDetail = defineWriteTool({
  name: "update_plan_detail",
  title: "Update a plan detail",
  description:
    "Change one record of a household's plan, or add one, and save it to the base plan at once through the fact " +
    "finder's review and save, all or nothing. sectionId and the cells' keys are fact finder section and column " +
    "ids; an unknown one is refused with the valid ids. recordId updates that record, fixedRow sets that fixed " +
    "row, and neither adds a record. Nothing is saved, and no draft is left, when nothing changes, a line can't " +
    "save or the record changed meanwhile. Returns the saved lines, each field from its value on record to the " +
    "new one, and any line left out, with the reason.",
  inputSchema: z.object({
    clientId: clientIdArg,
    sectionId: z.string().describe("A fact finder section id, e.g. \"retirement\"."),
    recordId: z.string().optional().describe("The record to update, from list_plan_details or a step's existingRecords."),
    fixedRow: fillRow.shape.fixedRow,
    cells: z
      .record(z.string(), cellValue)
      .refine((c) => Object.keys(c).length >= 1 && Object.keys(c).length <= MAX_EDIT_CELLS, `Give 1 to ${MAX_EDIT_CELLS} cells.`)
      .describe("Column id to value; a percent column takes 6.5 for 6.5%."),
    sources: cellSources,
  }),
  page: "netWorth",
  handler: async ({ clientId, sectionId, recordId, fixedRow, cells, sources }, { principal, firmId }) => {
    // Checked and built before anything is created: an unknown section, column or fixed row leaves no draft.
    const section = checkEdit(sectionId, fixedRow, cells);
    const link = recordId !== undefined ? { recordId } : fixedRow === undefined ? ("new" as const) : undefined;
    const { rowId, ops, stamps } = rowOps({ sectionId, fixedRow, cells, link, sources });
    const scenarioId = await draftBaseCase(principal, clientId);
    const imp = await createDraft(principal, clientId, firmId, scenarioId, `Claude edit: ${section.label}`);
    const scope = { importId: imp.id, clientId, firmId };

    // R37: everything that can refuse comes before the save, which writes all or nothing.
    const { changeSet, ticks, closed } = await orDiscard(scope, principal.userId, async () => {
      // The commit gate: an edit is a save, so it counts against the fact finder's save limit.
      const gate = await openStep(principal, clientId, imp.id, "commit");
      const current = readFactFinderState(gate.payloadJson);
      const edited = await editFactFinder(scope, current, current.version, ops, { by: "chat", actorId: principal.userId, stamps });
      if (!edited.ok) throw new McpInputError(edited.error);
      // R19: no AI step — a single edit carries no free text to place.
      const changeSet = await reviewDraft(scope, edited.state, principal.userId, null);
      const blocked = changeSet.lines.filter((l) => l.blocked);
      if (blocked.length > 0) throw new McpInputError(blocked.map(cannotSave).join(" "));
      if (changeSet.lines.every((l) => l.action === "none")) throw new McpInputError(NOTHING_TO_CHANGE_MESSAGE);
      const ticks = editTicks(changeSet, rowId, cells);
      return { changeSet, ticks, closed: await saveDraft(scope, principal, changeSet, ticks) };
    });

    const { lines, warnings } = changeListView({ ...changeSet, lines: closed.savedLines }, ticks);
    return {
      importId: imp.id,
      saved: lines,
      ...(closed.leftOut.length > 0 && { leftOut: closed.leftOut }),
      ...(warnings.length > 0 && { warnings }),
    };
  },
  auditMetadata: (args, result) => ({ importId: result.importId, sectionId: args.sectionId, saved: result.saved.length }),
});

const rate = z.number().optional();

/**
 * R38: rates the core bounds only to ±1000%, or not at all, so 3 sent for 3%
 * would save as 300%. The tax rates keep the core's own 0..1 check.
 */
const isGrowthOrInflation = (key: string) =>
  key === "inflationRate" || key === "taxInflationRate" || key === "ssWageGrowthRate" || key.startsWith("defaultGrowth");

/** A stored value as the plan reads it: numeric columns come back as strings. */
const asRead = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value) : (value ?? null);

const updatePlanAssumptions = defineWriteTool({
  name: "update_plan_assumptions",
  title: "Change plan assumptions",
  description:
    "Change a household's plan assumptions in its base plan. Setting inflationRate or a defaultGrowth rate makes " +
    "it the plan's custom rate. Returns each setting changed, from the value the plan used to the new one.",
  inputSchema: z.object({
    clientId: clientIdArg,
    changes: z
      .object({
        inflationRate: rate,
        taxInflationRate: rate.describe("Tax bracket inflation."),
        ssWageGrowthRate: rate,
        defaultGrowthTaxable: rate,
        defaultGrowthCash: rate,
        defaultGrowthRetirement: rate,
        defaultGrowthRealEstate: rate,
        defaultGrowthBusiness: rate,
        defaultGrowthLifeInsurance: rate,
        flatFederalRate: rate,
        flatStateRate: rate,
        irdTaxRate: rate.describe("Heirs' income tax rate on inherited retirement accounts."),
        residenceState: z.string().optional().describe("USPS two-letter state code."),
      })
      .refine((c) => Object.keys(c).length > 0, "Give at least one change.")
      .describe("Rates are fractions, 0.03 = 3%. defaultGrowth<X>: the default growth rate of that asset class's accounts."),
  }),
  page: "assumptions",
  handler: async ({ clientId, changes }, { principal, firmId }) => {
    for (const [key, value] of Object.entries(changes)) {
      if (isGrowthOrInflation(key) && typeof value === "number" && Math.abs(value) > 1) {
        throw new McpInputError(`${key} is out of range: rates are fractions, 0.03 = 3%.`);
      }
    }
    const body: Record<string, unknown> = { ...changes };
    if (changes.inflationRate !== undefined) body.inflationRateSource = "custom";
    for (const key of Object.keys(changes)) {
      if (key.startsWith("defaultGrowth")) body[key.replace("defaultGrowth", "growthSource")] = "custom";
    }
    // Before: the base case as the plan reads it — the loader the Details screen and Forge read it through.
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
    const before: Record<string, unknown> = { ...effectiveTree.planSettings };
    // R4: the principal is for the core's base-case lookup; the runner's edit gate is the access check.
    const result = await updatePlanSettingsForClient({ clientId, firmId, actorId: principal.userId, body, principal });
    if (!result.ok) throw new McpInputError(result.error);
    return { changed: Object.keys(body).map((key) => ({ key, from: before[key] ?? null, to: asRead(result.data[key]) })) };
  },
  auditMetadata: (args) => ({ keys: Object.keys(args.changes) }),
});

const REMOVABLE_KINDS = ["account", "liability", "income", "expense", "savings_rule"] as const;
type RemovableKind = (typeof REMOVABLE_KINDS)[number];

/** The row's name as start_fact_finder_step shows it; a savings rule shows its account's. Read before the delete. */
async function removableLabel(kind: RemovableKind, clientId: string, recordId: string) {
  if (kind === "savings_rule") {
    const [row] = await db
      .select({ name: accounts.name })
      .from(savingsRules)
      .leftJoin(accounts, eq(savingsRules.accountId, accounts.id))
      .where(and(eq(savingsRules.id, recordId), eq(savingsRules.clientId, clientId)));
    return row ? (row.name ?? "Planned savings") : null;
  }
  const table = { account: accounts, liability: liabilities, income: incomes, expense: expenses }[kind];
  const [row] = await db
    .select({ name: table.name })
    .from(table)
    .where(and(eq(table.id, recordId), eq(table.clientId, clientId)));
  return row?.name ?? null;
}

/** R5: the four access-checking cores take the principal; the savings rule core has no access check of its own. */
function removeRecord(
  kind: RemovableKind,
  recordId: string,
  base: { clientId: string; firmId: string; actorId: string },
  principal: McpPrincipal,
): Promise<EntityWriteResult<{ id: string }>> {
  switch (kind) {
    case "account":
      return deleteAccountForClient({ ...base, accountId: recordId, principal });
    case "liability":
      return deleteLiabilityForClient({ ...base, liabilityId: recordId, principal });
    case "income":
      return deleteIncomeForClient({ ...base, incomeId: recordId, principal });
    case "expense":
      return deleteExpenseForClient({ ...base, expenseId: recordId, principal });
    case "savings_rule":
      return deleteSavingsRuleForClient({ ...base, ruleId: recordId });
  }
}

const removePlanDetail = defineWriteTool({
  name: "remove_plan_detail",
  title: "Remove a plan row",
  description:
    "Permanently remove one account, liability, income, expense or savings rule from a household's plan. Never a household.",
  inputSchema: z.object({
    clientId: clientIdArg,
    kind: z.enum(REMOVABLE_KINDS),
    recordId: z.string().describe("From list_plan_details, or a step's existingRecords (savings rules are only there)."),
  }),
  destructive: true,
  page: "netWorth",
  handler: async ({ clientId, kind, recordId }, { principal, firmId }) => {
    const label = await removableLabel(kind, clientId, recordId);
    const result = await removeRecord(kind, recordId, { clientId, firmId, actorId: principal.userId }, principal);
    if (!result.ok) throw new McpInputError(result.error);
    return { removed: { kind, recordId, label: label ?? kind.replace("_", " ") } };
  },
  auditMetadata: (args) => ({ kind: args.kind, recordId: args.recordId }),
});

export const householdBuildingTools: McpTool[] = [
  createHousehold,
  startFactFinderStep,
  fillFactFinderStep,
  reviewFactFinderStep,
  saveFactFinderStep,
  getMissingFacts,
  updatePlanDetail,
  updatePlanAssumptions,
  removePlanDetail,
];
