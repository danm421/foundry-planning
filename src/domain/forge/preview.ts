// src/domain/forge/preview.ts
//
// Turns a proposed scenario-write (the model's raw tool args, captured at the
// approval interrupt in graph.ts) into a `WritePreview` for the approval card.
//
//   • formatProposedWrite(call)            — pure, synchronous, no IO.
//   • describeProposedWrite(call, ctx?)     — async; with an auth context it
//                                             enriches a propose_changes preview
//                                             with the live field-level diff and
//                                             a combined end-of-plan portfolio
//                                             impact line, computed against the
//                                             current effective tree.
//
// The pure formatter is the contract every approval card depends on; the async
// enrichment is BEST-EFFORT — it must never throw or block approval, so all of
// its IO is wrapped in try/catch and the pure result is the fallback.

import type { WritePreview } from "@/domain/forge/types";
import type { ForgeAuthContext } from "@/domain/forge/state";
import {
  describeChangeUnit,
  type ChangeUnit,
} from "@/lib/scenario/scenario-change-describe";
import { computeRowDiff } from "@/lib/scenario/diff-row";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { scenarioChangesToBaseWrites } from "@/lib/scenario/scenario-changes-to-base-writes";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { runProjection } from "@/engine";
import {
  assertEntitiesInClient,
  assertAccountsInClient,
  assertBusinessAccountsInClient,
  assertModelPortfoliosInFirm,
  assertTickerPortfoliosInFirm,
} from "@/lib/db-scoping";
import { z } from "zod";
import { formatZodIssues } from "@/lib/schemas/common";
import {
  expenseCreateSchema,
  expenseUpdateSchema,
} from "@/lib/schemas/expenses";
import {
  incomeCreateSchema,
  incomeUpdateSchema,
} from "@/lib/schemas/incomes";
import {
  liabilityCreateSchema,
  liabilityUpdateSchema,
} from "@/lib/schemas/liabilities";
import {
  accountCreateSchema,
  accountUpdateSchema,
} from "@/lib/schemas/accounts";
import { createDiffLines } from "@/lib/clients/create-diff-adapter";
import type {
  OpType,
  ScenarioChange,
  TargetKind,
} from "@/engine/scenario/types";
import type { ClientData } from "@/engine/types";

/**
 * A single proposed write as captured at the approval interrupt: the tool name
 * plus the model's validated tool-call args. Mirrors the `{ id, name, args }`
 * shape graph.ts emits in `approval_required.calls`.
 */
export type ProposedWrite = { name: string; args: Record<string, unknown> };

/** One change inside a propose_changes call (the model's raw arg shape). */
type ProposedChange = {
  opType: OpType;
  targetKind: TargetKind;
  targetId: string;
  desiredFields?: Record<string, unknown>;
  entity?: Record<string, unknown>;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Human label for a scenario ref token: "base" → "Base", else the raw id. */
function refLabel(token: string | undefined): string {
  if (!token) return "Base";
  return token === "base" ? "Base" : token;
}

/** Coerce the raw `changes` arg into a typed array, tolerating bad input. */
function readChanges(args: Record<string, unknown>): ProposedChange[] {
  const raw = args.changes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is ProposedChange => !!c && typeof c === "object");
}

/**
 * Build the engine `ScenarioChange` (+ `enabled`) for one proposed change so we
 * can hand it to `describeChangeUnit`. Edit payload is the `{field:{from,to}}`
 * map the describer + engine consume; add payload is the full entity; remove is
 * null. `from` is undefined here because the pure formatter has no base row.
 */
function toScenarioChange(
  c: ProposedChange,
): ScenarioChange & { enabled: boolean } {
  let payload: unknown;
  if (c.opType === "edit") {
    payload = Object.fromEntries(
      Object.entries(c.desiredFields ?? {}).map(([k, v]) => [k, { from: undefined, to: v }]),
    );
  } else if (c.opType === "add") {
    payload = c.entity ?? {};
  } else {
    payload = null;
  }
  return {
    id: `preview:${c.targetKind}:${c.targetId}`,
    scenarioId: "preview",
    opType: c.opType,
    targetKind: c.targetKind,
    targetId: c.targetId,
    payload,
    toggleGroupId: null,
    orderIndex: 0,
    enabled: true,
  };
}

/** describeChangeUnit line for one proposed change (no resolved target names). */
function describeProposedChange(c: ProposedChange): string {
  const unit: ChangeUnit = { kind: "single", change: toScenarioChange(c) };
  return describeChangeUnit(unit, {});
}

function previewCreateScenario(args: Record<string, unknown>): WritePreview {
  const name = str(args.name) ?? "(unnamed)";
  const copyFrom = str(args.copyFrom);
  const summary = copyFrom
    ? `Create scenario “${name}”, cloned from ${refLabel(copyFrom)}.`
    : `Create scenario “${name}” from scratch (empty).`;
  return { name: "create_scenario", summary };
}

function previewProposeChanges(args: Record<string, unknown>): WritePreview {
  const groupName = str(args.groupName);
  const changes = readChanges(args);
  const n = changes.length;
  const label = groupName ? ` “${groupName}”` : "";
  const summary = `Propose ${n} change${n === 1 ? "" : "s"}${label}.`;
  const details = changes.map(describeProposedChange);
  return { name: "propose_changes", summary, details };
}

function previewRevertChange(args: Record<string, unknown>): WritePreview {
  const targetKind = str(args.targetKind) ?? "change";
  const opType = str(args.opType);
  const opLabel = opType ? ` (${opType})` : "";
  return {
    name: "revert_change",
    summary: `Remove proposed change on ${targetKind}${opLabel}.`,
  };
}

function previewCrmDeleteNote(a: Record<string, unknown>): WritePreview {
  return { name: "crm_delete_note", summary: `Delete note ${str(a.noteId) ?? ""}.`.trim() };
}

function previewCrmDeleteTask(a: Record<string, unknown>): WritePreview {
  return { name: "crm_delete_task", summary: `Delete task ${str(a.taskId) ?? ""}.`.trim() };
}

function previewCrmCreateTasks(a: Record<string, unknown>): WritePreview {
  const tasks = Array.isArray(a.tasks) ? a.tasks : [];
  const titles = tasks.map((t) => (t as { title?: string })?.title).filter(Boolean) as string[];
  return { name: "crm_create_tasks", summary: `Create ${tasks.length} task${tasks.length === 1 ? "" : "s"}: ${titles.slice(0, 5).join(", ")}.` };
}

function previewCreateHousehold(a: Record<string, unknown>): WritePreview {
  const name = str(a.name) ?? "(unnamed)";
  const state = str(a.state);
  const pc = a.primaryContact as { firstName?: string; lastName?: string } | undefined;
  const contact = pc ? `${pc.firstName ?? ""} ${pc.lastName ?? ""}`.trim() : "";
  const tail = [contact && `primary contact ${contact}`, state].filter(Boolean).join(", ");
  return { name: "create_household", summary: `Create household "${name}"${tail ? ` — ${tail}` : ""}.` };
}

function previewSetUpPlan(a: Record<string, unknown>): WritePreview {
  const filing = str(a.filingStatus);
  const ret = typeof a.retirementAge === "number" ? a.retirementAge : undefined;
  const bits = [ret != null && `retire at ${ret}`, filing && `filing ${filing}`].filter(Boolean).join(", ");
  return { name: "set_up_plan", summary: `Set up a financial plan${bits ? ` (${bits})` : ""}.` };
}

/**
 * `build_plan` has two shapes sharing one tool name (preview.ts distinguishes
 * by args, not by mode):
 *   - GLOBAL mode: mints a brand-new household + client + base plan from the
 *     full set of args below — the advisor is approving the creation of a
 *     real household/client row, so every arg that could be mis-heard (name,
 *     DOB, filing status, retirement age, life expectancy) belongs in
 *     `details` for HITL to catch.
 *   - CLIENT mode: `z.object({})` — no args, just refreshes the CURRENT
 *     client's plan build. That variant must not render a card full of
 *     `undefined`, so it gets its own short summary and no details.
 * Numbers render as plain values, matching `previewSetUpPlan` above.
 */
function previewBuildPlan(a: Record<string, unknown>): WritePreview {
  const householdName = str(a.householdName);
  if (!householdName) {
    return {
      name: "build_plan",
      summary: "Start a plan build for this client from documents you'll upload.",
    };
  }

  const primaryName = [str(a.primaryFirstName), str(a.primaryLastName)].filter(Boolean).join(" ");
  const primaryDob = str(a.primaryDob);
  const spouseName = [str(a.spouseFirstName), str(a.spouseLastName)].filter(Boolean).join(" ");
  const spouseDob = str(a.spouseDob);
  const state = str(a.state);
  const filing = str(a.filingStatus);
  const ret = typeof a.retirementAge === "number" ? a.retirementAge : undefined;
  const life = typeof a.lifeExpectancy === "number" ? a.lifeExpectancy : undefined;
  const spouseRet = typeof a.spouseRetirementAge === "number" ? a.spouseRetirementAge : undefined;
  const spouseLife = typeof a.spouseLifeExpectancy === "number" ? a.spouseLifeExpectancy : undefined;

  const details = [
    primaryName && `Primary: ${primaryName}${primaryDob ? ` (DOB ${primaryDob})` : ""}`,
    spouseName && `Spouse: ${spouseName}${spouseDob ? ` (DOB ${spouseDob})` : ""}`,
    state && `State: ${state}`,
    filing && `Filing status: ${filing}`,
    ret != null && `Retirement age: ${ret}`,
    life != null && `Life expectancy: ${life}`,
    spouseRet != null && `Spouse retirement age: ${spouseRet}`,
    spouseLife != null && `Spouse life expectancy: ${spouseLife}`,
  ].filter(Boolean) as string[];

  return {
    name: "build_plan",
    summary: `Create household "${householdName}" and start a new plan build.`,
    details,
  };
}

function previewTasksCreate(a: Record<string, unknown>): WritePreview {
  const title = str(a.title) ?? "(untitled)";
  const due = str(a.dueDate);
  const bits = [str(a.priority), due && `due ${due}`, a.householdId ? "for a client household" : "firm-level"]
    .filter(Boolean)
    .join(", ");
  return { name: "tasks_create", summary: `Create task "${title}"${bits ? ` (${bits})` : ""}.` };
}

function previewTasksDelete(a: Record<string, unknown>): WritePreview {
  return {
    name: "tasks_delete",
    summary: `Delete task ${str(a.taskId) ?? ""} — permanent, removes its comments and history.`.trim(),
  };
}

function previewAddExpense(a: Record<string, unknown>): WritePreview {
  const name = str(a.name) ?? "(unnamed)";
  const type = str(a.type);
  const typeLabel = type ? ` (${type})` : "";
  return { name: "add_expense", summary: `Add expense “${name}”${typeLabel}.` };
}

function previewUpdateExpense(a: Record<string, unknown>): WritePreview {
  const id = str(a.expenseId) ?? "";
  const name = str(a.name);
  const label = name ? `“${name}” ` : "";
  return { name: "update_expense", summary: `Update expense ${label}(id ${id}).`.trim() };
}

function previewRemoveExpense(a: Record<string, unknown>): WritePreview {
  const id = str(a.expenseId) ?? "";
  return { name: "remove_expense", summary: `Remove expense (id ${id}).` };
}

function previewAddIncome(a: Record<string, unknown>): WritePreview {
  const name = str(a.name) ?? "(unnamed)";
  const type = str(a.type);
  const typeLabel = type ? ` (${type})` : "";
  return { name: "add_income", summary: `Add income “${name}”${typeLabel}.` };
}

function previewUpdateIncome(a: Record<string, unknown>): WritePreview {
  const id = str(a.incomeId) ?? "";
  const name = str(a.name);
  const label = name ? `“${name}” ` : "";
  return { name: "update_income", summary: `Update income ${label}(id ${id}).`.trim() };
}

function previewRemoveIncome(a: Record<string, unknown>): WritePreview {
  const id = str(a.incomeId) ?? "";
  return { name: "remove_income", summary: `Remove income (id ${id}).` };
}

function previewAddLiability(a: Record<string, unknown>): WritePreview {
  const name = str(a.name) ?? "(unnamed)";
  return { name: "add_liability", summary: `Add liability “${name}”.` };
}

function previewUpdateLiability(a: Record<string, unknown>): WritePreview {
  const id = str(a.liabilityId) ?? "";
  const name = str(a.name);
  const label = name ? `“${name}” ` : "";
  return { name: "update_liability", summary: `Update liability ${label}(id ${id}).`.trim() };
}

function previewRemoveLiability(a: Record<string, unknown>): WritePreview {
  const id = str(a.liabilityId) ?? "";
  return { name: "remove_liability", summary: `Remove liability (id ${id}).` };
}

function previewAddAccount(a: Record<string, unknown>): WritePreview {
  const name = str(a.name) ?? "(unnamed)";
  return { name: "add_account", summary: `Add account “${name}”.` };
}

function previewUpdateAccount(a: Record<string, unknown>): WritePreview {
  const id = str(a.accountId) ?? "";
  const name = str(a.name);
  const label = name ? `“${name}” ` : "";
  return { name: "update_account", summary: `Update account ${label}(id ${id}).`.trim() };
}

function previewRemoveAccount(a: Record<string, unknown>): WritePreview {
  const id = str(a.accountId) ?? "";
  return { name: "remove_account", summary: `Remove account (id ${id}).` };
}

function previewPromoteToBase(args: Record<string, unknown>): WritePreview {
  const id = str(args.scenarioId) ?? "(scenario)";
  return {
    name: "promote_to_base",
    summary: `Promote scenario ${id} to base — DESTRUCTIVE: overwrites the base plan, auto-snapshots the current base, and deletes ALL other scenarios.`,
  };
}

function previewCompareAndSnapshot(args: Record<string, unknown>): WritePreview {
  const name = str(args.name) ?? "(unnamed)";
  const left = refLabel(str(args.leftRef));
  const right = refLabel(str(args.rightRef));
  return {
    name: "compare_and_snapshot",
    summary: `Save comparison snapshot “${name}” (${left} vs ${right}).`,
  };
}

/**
 * Pure, synchronous preview. A switch over the four scenario-write tool names
 * with a graceful fallback for anything unrecognised (the fallback still names
 * the tool so the card never renders blank).
 */
export function formatProposedWrite(call: ProposedWrite): WritePreview {
  switch (call.name) {
    case "create_scenario":
      return previewCreateScenario(call.args);
    case "propose_changes":
      return previewProposeChanges(call.args);
    case "revert_change":
      return previewRevertChange(call.args);
    case "compare_and_snapshot":
      return previewCompareAndSnapshot(call.args);
    case "promote_to_base":
      return previewPromoteToBase(call.args);
    case "add_expense":
      return previewAddExpense(call.args);
    case "update_expense":
      return previewUpdateExpense(call.args);
    case "remove_expense":
      return previewRemoveExpense(call.args);
    case "add_income":
      return previewAddIncome(call.args);
    case "update_income":
      return previewUpdateIncome(call.args);
    case "remove_income":
      return previewRemoveIncome(call.args);
    case "add_liability":
      return previewAddLiability(call.args);
    case "update_liability":
      return previewUpdateLiability(call.args);
    case "remove_liability":
      return previewRemoveLiability(call.args);
    case "add_account":
      return previewAddAccount(call.args);
    case "update_account":
      return previewUpdateAccount(call.args);
    case "remove_account":
      return previewRemoveAccount(call.args);
    case "crm_delete_note":
      return previewCrmDeleteNote(call.args);
    case "crm_delete_task":
      return previewCrmDeleteTask(call.args);
    case "crm_create_tasks":
      return previewCrmCreateTasks(call.args);
    case "create_household":
      return previewCreateHousehold(call.args);
    case "set_up_plan":
      return previewSetUpPlan(call.args);
    case "build_plan":
      return previewBuildPlan(call.args);
    case "tasks_create":
      return previewTasksCreate(call.args);
    case "tasks_delete":
      return previewTasksDelete(call.args);
    default:
      return { name: call.name, summary: `Proposed ${call.name}.` };
  }
}

/** Find the row carrying `id` across every array field on the effective tree. */
function findRowById(
  tree: ClientData,
  id: string,
): Record<string, unknown> | null {
  // ClientData has heterogeneous typed fields; iterate its values as a generic map.
  for (const value of Object.values(tree as unknown as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (row && typeof row === "object" && (row as { id?: unknown }).id === id) {
        return row as Record<string, unknown>;
      }
    }
  }
  return null;
}

function fmt(v: unknown): string {
  return v == null ? "—" : String(v);
}

/**
 * Live field-level `field: from → to` lines for one edit, diffed against the
 * current effective row. Returns null when the target row can't be resolved or
 * the diff isn't an edit, so the caller can fall back to the pure formatter.
 */
function enrichedEditLines(
  tree: ClientData,
  c: ProposedChange,
): string[] | null {
  const current = findRowById(tree, c.targetId);
  if (!current) return null;
  const diff = computeRowDiff(current, { ...current, ...c.desiredFields });
  if (diff.kind !== "edit") return null;
  return diff.fields.map((f) => `${f.field}: ${fmt(f.from)} → ${fmt(f.to)}`);
}

/**
 * Combined, signed end-of-plan portfolio delta of the proposed (not-yet-
 * persisted) edits, computed against the live tree. Applies the proposed
 * changes in-memory via `applyScenarioChanges` — the same mechanism the
 * whatif_withdrawal tool uses — then re-projects and diffs `portfolioAssets.total`
 * (the end-of-plan portfolio metric `compare_scenarios` reports). Returns null
 * if there are no changes (so we omit the line rather than print "$0").
 */
function computePortfolioImpact(
  baseTree: ClientData,
  changes: ProposedChange[],
): number | null {
  if (changes.length === 0) return null;
  const scenarioChanges: ScenarioChange[] = changes.map(toScenarioChange);
  const baseProjection = runProjection(baseTree);
  const { effectiveTree } = applyScenarioChanges(baseTree, scenarioChanges, {}, []);
  const scenarioProjection = runProjection(effectiveTree);
  const baseEnd = baseProjection[baseProjection.length - 1]?.portfolioAssets.total ?? 0;
  const scenarioEnd =
    scenarioProjection[scenarioProjection.length - 1]?.portfolioAssets.total ?? 0;
  return scenarioEnd - baseEnd;
}

/** Plain-language join of a safeParse error's issues, matching the core's format. */
function zodErrorMessage(error: z.ZodError): string {
  return formatZodIssues(error)
    .map((i) => i.message)
    .join("; ");
}

/**
 * Run the SAME FK asserts the expense AND income create/update cores run
 * (entities, accounts, business accounts) — all client-scoped, mirroring the
 * cores. Both entities share the identical three-assert sequence on the same
 * three FK fields, so one helper covers both. Returns a validation message on
 * the first failed assert, or null if every FK is in-client. NO insert/update —
 * this is a dry run.
 */
async function assertDetailFks(
  clientId: string,
  fields: {
    ownerEntityId?: string | null;
    ownerAccountId?: string | null;
    cashAccountId?: string | null;
  },
): Promise<string | null> {
  const ent = await assertEntitiesInClient(clientId, [fields.ownerEntityId]);
  if (!ent.ok) return ent.reason;
  const acct = await assertAccountsInClient(clientId, [
    fields.cashAccountId,
    fields.ownerAccountId,
  ]);
  if (!acct.ok) return acct.reason;
  if (fields.ownerAccountId != null) {
    const biz = await assertBusinessAccountsInClient(clientId, [fields.ownerAccountId]);
    if (!biz.ok) return biz.reason;
  }
  return null;
}

/**
 * Run the SAME FK asserts the liability create core runs (entities for
 * ownerEntityId, accounts for linkedPropertyId, and — when parentAccountId is
 * set — the business-account check). All client-scoped; the
 * assertBusinessAccountsInClient call covers BOTH the cross-tenant AND the
 * not-business rejects the core enforces. Returns the first failed assert's
 * message, or null when every FK is in-client. NO insert — dry run only.
 */
async function assertLiabilityFks(
  clientId: string,
  fields: {
    ownerEntityId?: string | null;
    linkedPropertyId?: string | null;
    parentAccountId?: string | null;
  },
): Promise<string | null> {
  const ent = await assertEntitiesInClient(clientId, [fields.ownerEntityId]);
  if (!ent.ok) return ent.reason;
  const acct = await assertAccountsInClient(clientId, [fields.linkedPropertyId]);
  if (!acct.ok) return acct.reason;
  if (fields.parentAccountId != null) {
    const biz = await assertBusinessAccountsInClient(clientId, [fields.parentAccountId]);
    if (!biz.ok) return biz.reason;
  }
  return null;
}

/** A single proposed owner from the liability owners[] split (model arg shape). */
type ProposedOwner = {
  kind?: string;
  familyMemberId?: string;
  entityId?: string;
  percent?: number;
};

/**
 * Cascade lines describing how the liability's ownership resolves (spec §5).
 * A non-null parentAccountId means the row inherits ownership via the business
 * account (no per-row owners); otherwise each owner[] entry renders as one line.
 * Returns [] when neither applies, so the caller appends nothing.
 */
function liabilityOwnershipLines(
  parentAccountId: string | null | undefined,
  owners: ProposedOwner[] | undefined,
): string[] {
  if (parentAccountId != null) {
    return ["Owned via parent business account (no separate owners)."];
  }
  if (owners && owners.length > 0) {
    return owners.map(
      (o) =>
        `Owner: ${o.kind} ${o.familyMemberId ?? o.entityId ?? ""} (${Math.round(
          (o.percent ?? 0) * 100,
        )}%)`,
    );
  }
  return [];
}

/**
 * Run the SAME FK asserts the account create core runs (entities for
 * ownerEntityId, FIRM-scoped model + ticker portfolios, and — when
 * parentAccountId is set — the parent-business check). Unlike assertLiabilityFks
 * this takes `firmId` because the portfolio asserts are firm-scoped. The
 * assertBusinessAccountsInClient call covers BOTH the cross-tenant AND the
 * not-business rejects the core enforces. Returns the first failed assert's
 * message, or null when every FK is in-client/in-firm. NO insert — dry run only.
 */
async function assertAccountFks(
  clientId: string,
  firmId: string,
  fields: {
    ownerEntityId?: string | null;
    modelPortfolioId?: string | null;
    tickerPortfolioId?: string | null;
    parentAccountId?: string | null;
  },
): Promise<string | null> {
  const ent = await assertEntitiesInClient(clientId, [fields.ownerEntityId]);
  if (!ent.ok) return ent.reason;
  const mp = await assertModelPortfoliosInFirm(firmId, [fields.modelPortfolioId]);
  if (!mp.ok) return mp.reason;
  const tp = await assertTickerPortfoliosInFirm(firmId, [fields.tickerPortfolioId]);
  if (!tp.ok) return tp.reason;
  if (fields.parentAccountId != null) {
    const biz = await assertBusinessAccountsInClient(clientId, [fields.parentAccountId]);
    if (!biz.ok) return biz.reason;
  }
  return null;
}

/**
 * Cascade lines describing the account-specific consequences (spec §5):
 *   • a new top-level business (category === "business", no parentAccountId) also
 *     provisions a system-managed cash sub-account — a guaranteed-but-unvalued
 *     consequence (we do NOT fabricate the child id, per spec §11);
 *   • deriveFromHoldings === true recomputes value + asset mix post-write;
 *   • a per-row ownership split (owners[], no parentAccountId) renders one line
 *     per owner (the liability ownership-lines style).
 * Returns [] when none apply, so the caller appends nothing.
 */
function accountCascadeLines(parsed: {
  category?: string;
  parentAccountId?: string | null;
  deriveFromHoldings?: boolean;
  owners?: unknown;
}): string[] {
  const lines: string[] = [];
  const isChild = parsed.parentAccountId != null;
  if (parsed.category === "business" && !isChild) {
    lines.push("Will also create a business-cash sub-account.");
  }
  if (parsed.deriveFromHoldings === true) {
    lines.push("Value and allocation will be recomputed from holdings after save (post-write).");
  }
  const owners = parsed.owners as ProposedOwner[] | undefined;
  if (!isChild && owners && owners.length > 0) {
    lines.push(
      ...owners.map(
        (o) =>
          `Owner: ${o.kind} ${o.familyMemberId ?? o.entityId ?? ""} (${Math.round(
            (o.percent ?? 0) * 100,
          )}%)`,
      ),
    );
  }
  return lines;
}

/**
 * Dry-run enrichment for add_expense: zod-parse via expenseCreateSchema, run the
 * same FK asserts the core runs (NO insert), then render the would-be new row as
 * `field: value` lines via createDiffLines (since computeRowDiff(null,row) has no
 * fields). On a zod or FK failure, surface the plain-language validation error as
 * the summary with no diff.
 */
async function enrichAddExpense(
  base: WritePreview,
  args: Record<string, unknown>,
  clientId: string,
): Promise<WritePreview> {
  const parsed = expenseCreateSchema.safeParse(args);
  if (!parsed.success) {
    return { ...base, summary: zodErrorMessage(parsed.error) };
  }
  const fkError = await assertDetailFks(clientId, parsed.data);
  if (fkError) return { ...base, summary: fkError };
  return { ...base, details: createDiffLines(parsed.data) };
}

/**
 * Dry-run enrichment for update_expense: zod-parse the (non-id) args via
 * expenseUpdateSchema, run the same FK asserts (NO update), load the live row,
 * and diff `currentRow → {...currentRow, ...parsed}` to render `field: from → to`
 * lines. On a zod or FK failure, surface the validation error as the summary.
 */
async function enrichUpdateExpense(
  base: WritePreview,
  args: Record<string, unknown>,
  ctx: ForgeAuthContext,
): Promise<WritePreview> {
  const { expenseId, ...rest } = args;
  const id = typeof expenseId === "string" ? expenseId : undefined;
  const parsed = expenseUpdateSchema.safeParse(rest);
  if (!parsed.success) {
    return { ...base, summary: zodErrorMessage(parsed.error) };
  }
  const fkError = await assertDetailFks(ctx.clientId, parsed.data);
  if (fkError) return { ...base, summary: fkError };

  if (!id) return base;
  const { effectiveTree } = await loadEffectiveTree(
    ctx.clientId,
    ctx.firmId,
    ctx.scenarioId,
    {},
  );
  const current = findRowById(effectiveTree, id);
  if (!current) return base;
  const diff = computeRowDiff(current, { ...current, ...parsed.data });
  if (diff.kind !== "edit") return base;
  return {
    ...base,
    details: diff.fields.map((f) => `${f.field}: ${fmt(f.from)} → ${fmt(f.to)}`),
  };
}

/**
 * Dry-run enrichment for add_income: zod-parse via incomeCreateSchema, run the
 * same FK asserts the core runs (NO insert), then render the would-be new row as
 * `field: value` lines via createDiffLines. On a zod or FK failure, surface the
 * plain-language validation error as the summary with no diff. Mirrors
 * enrichAddExpense.
 */
async function enrichAddIncome(
  base: WritePreview,
  args: Record<string, unknown>,
  clientId: string,
): Promise<WritePreview> {
  const parsed = incomeCreateSchema.safeParse(args);
  if (!parsed.success) {
    return { ...base, summary: zodErrorMessage(parsed.error) };
  }
  const fkError = await assertDetailFks(clientId, parsed.data);
  if (fkError) return { ...base, summary: fkError };
  return { ...base, details: createDiffLines(parsed.data) };
}

/**
 * Dry-run enrichment for update_income: zod-parse the (non-id) args via
 * incomeUpdateSchema, run the same FK asserts (NO update), load the live row,
 * and diff `currentRow → {...currentRow, ...parsed}` to render `field: from → to`
 * lines. On a zod or FK failure, surface the validation error as the summary.
 * Mirrors enrichUpdateExpense.
 */
async function enrichUpdateIncome(
  base: WritePreview,
  args: Record<string, unknown>,
  ctx: ForgeAuthContext,
): Promise<WritePreview> {
  const { incomeId, ...rest } = args;
  const id = typeof incomeId === "string" ? incomeId : undefined;
  const parsed = incomeUpdateSchema.safeParse(rest);
  if (!parsed.success) {
    return { ...base, summary: zodErrorMessage(parsed.error) };
  }
  const fkError = await assertDetailFks(ctx.clientId, parsed.data);
  if (fkError) return { ...base, summary: fkError };

  if (!id) return base;
  const { effectiveTree } = await loadEffectiveTree(
    ctx.clientId,
    ctx.firmId,
    ctx.scenarioId,
    {},
  );
  const current = findRowById(effectiveTree, id);
  if (!current) return base;
  const diff = computeRowDiff(current, { ...current, ...parsed.data });
  if (diff.kind !== "edit") return base;
  return {
    ...base,
    details: diff.fields.map((f) => `${f.field}: ${fmt(f.from)} → ${fmt(f.to)}`),
  };
}

/**
 * Dry-run enrichment for add_liability: zod-parse via liabilityCreateSchema, run
 * the same FK asserts the core runs (NO insert), then render the would-be new row
 * as `field: value` lines via createDiffLines, PLUS the ownership cascade line(s)
 * (Task-12 delta, spec §5): a parentAccountId means ownership is inherited via the
 * business account; otherwise each owner[] entry renders as its own line. The
 * owners array is stripped before createDiffLines (an array renders as
 * "[object Object]"). On a zod or FK failure, surface the validation error as the
 * summary with no diff. Mirrors enrichAddExpense.
 */
async function enrichAddLiability(
  base: WritePreview,
  args: Record<string, unknown>,
  clientId: string,
): Promise<WritePreview> {
  const parsed = liabilityCreateSchema.safeParse(args);
  if (!parsed.success) {
    return { ...base, summary: zodErrorMessage(parsed.error) };
  }
  const fkError = await assertLiabilityFks(clientId, parsed.data);
  if (fkError) return { ...base, summary: fkError };

  const { owners, ...rowForLines } = parsed.data;
  const details = createDiffLines(rowForLines);
  details.push(
    ...liabilityOwnershipLines(parsed.data.parentAccountId, owners as ProposedOwner[] | undefined),
  );
  return { ...base, details };
}

/**
 * Dry-run enrichment for update_liability: zod-parse the (non-id) args via
 * liabilityUpdateSchema, run the same FK asserts (NO update), load the live row,
 * and diff `currentRow → {...currentRow, ...parsed}` to render `field: from → to`
 * lines (owners excluded — they live in a satellite, not on the row), PLUS the
 * ownership cascade line(s). On a zod or FK failure, surface the validation error
 * as the summary. Mirrors enrichUpdateExpense.
 */
async function enrichUpdateLiability(
  base: WritePreview,
  args: Record<string, unknown>,
  ctx: ForgeAuthContext,
): Promise<WritePreview> {
  const { liabilityId, ...rest } = args;
  const id = typeof liabilityId === "string" ? liabilityId : undefined;
  const parsed = liabilityUpdateSchema.safeParse(rest);
  if (!parsed.success) {
    return { ...base, summary: zodErrorMessage(parsed.error) };
  }
  const fkError = await assertLiabilityFks(ctx.clientId, parsed.data);
  if (fkError) return { ...base, summary: fkError };

  if (!id) return base;
  const { effectiveTree } = await loadEffectiveTree(
    ctx.clientId,
    ctx.firmId,
    ctx.scenarioId,
    {},
  );
  const current = findRowById(effectiveTree, id);
  if (!current) return base;

  const { owners, ...rowFields } = parsed.data;
  const diff = computeRowDiff(current, { ...current, ...rowFields });
  const details = diff.kind === "edit"
    ? diff.fields.map((f) => `${f.field}: ${fmt(f.from)} → ${fmt(f.to)}`)
    : [];
  details.push(
    ...liabilityOwnershipLines(parsed.data.parentAccountId, owners as ProposedOwner[] | undefined),
  );
  if (details.length === 0) return base;
  return { ...base, details };
}

/**
 * Dry-run enrichment for add_account: zod-parse via accountCreateSchema, run the
 * same FK asserts the core runs (entities + firm-scoped portfolios + parent
 * business; NO insert), then render the would-be new row as `field: value` lines
 * via createDiffLines, PLUS the account cascade line(s) (the Phase-3 headline,
 * spec §5): a business row provisions a cash sub-account; deriveFromHoldings
 * recomputes value/allocation post-write; per-row owners render one line each.
 * The owners array is stripped before createDiffLines (an array renders as
 * "[object Object]"). On a zod or FK failure, surface the validation error as the
 * summary with no diff. Mirrors enrichAddLiability.
 */
async function enrichAddAccount(
  base: WritePreview,
  args: Record<string, unknown>,
  clientId: string,
  firmId: string,
): Promise<WritePreview> {
  const parsed = accountCreateSchema.safeParse(args);
  if (!parsed.success) {
    return { ...base, summary: zodErrorMessage(parsed.error) };
  }
  const fkError = await assertAccountFks(clientId, firmId, parsed.data);
  if (fkError) return { ...base, summary: fkError };

  // owners is stripped from the diff lines (an array renders as "[object Object]");
  // accountCascadeLines re-reads it off the full parsed.data spread below.
  const { owners, ...rowForLines } = parsed.data;
  void owners;
  const details = createDiffLines(rowForLines);
  // deriveFromHoldings is NOT a column on accountCreateSchema (the core mass-
  // assigns it on update / it drives the post-write sync), so the schema strips
  // it — read the flag off the RAW args for the cascade line.
  details.push(...accountCascadeLines({ ...parsed.data, deriveFromHoldings: args.deriveFromHoldings === true }));
  return { ...base, details };
}

/**
 * Dry-run enrichment for update_account: zod-parse the (non-id) args via
 * accountUpdateSchema (best-effort — the core mass-assigns rather than parsing,
 * but the schema gives a clean diff), run the same FK asserts (NO update), load
 * the live row, and surface the isDefaultChecking SYSTEM-MANAGED guard: when the
 * current row is default-checking AND the update would change a guarded field
 * (category / subType / parentAccountId, or owners present), set `summary` to the
 * matching core/route message and return (no diff). Otherwise diff
 * `currentRow → {...currentRow, ...parsed-minus-owners}` to render `field: from →
 * to` lines PLUS the account cascade line(s). On a zod or FK failure, surface the
 * validation error as the summary. Mirrors enrichUpdateLiability.
 */
async function enrichUpdateAccount(
  base: WritePreview,
  args: Record<string, unknown>,
  ctx: ForgeAuthContext,
): Promise<WritePreview> {
  const { accountId, ...rest } = args;
  const id = typeof accountId === "string" ? accountId : undefined;
  const parsed = accountUpdateSchema.safeParse(rest);
  if (!parsed.success) {
    return { ...base, summary: zodErrorMessage(parsed.error) };
  }
  const fkError = await assertAccountFks(ctx.clientId, ctx.firmId, parsed.data);
  if (fkError) return { ...base, summary: fkError };

  if (!id) return base;
  const { effectiveTree } = await loadEffectiveTree(
    ctx.clientId,
    ctx.firmId,
    ctx.scenarioId,
    {},
  );
  const current = findRowById(effectiveTree, id);
  if (!current) return base;

  const { owners, ...rowFields } = parsed.data;

  // isDefaultChecking system-managed guards (mirror the core/route messages):
  // surface the guard message and return before the diff.
  if (current.isDefaultChecking) {
    if ("category" in rowFields && rowFields.category !== current.category) {
      return { ...base, summary: "This is a system-managed cash account — its category can't be changed." };
    }
    if ("subType" in rowFields && rowFields.subType !== current.subType) {
      return { ...base, summary: "This is a system-managed cash account — its account type can't be changed." };
    }
    if ("parentAccountId" in rowFields && rowFields.parentAccountId !== current.parentAccountId) {
      return { ...base, summary: "A system-managed cash account's parent can't be changed." };
    }
    if (owners !== undefined) {
      return { ...base, summary: "This is a system-managed cash account — its ownership can't be changed." };
    }
  }

  const diff = computeRowDiff(current, { ...current, ...rowFields });
  const details = diff.kind === "edit"
    ? diff.fields.map((f) => `${f.field}: ${fmt(f.from)} → ${fmt(f.to)}`)
    : [];
  // deriveFromHoldings is stripped by accountUpdateSchema (the core mass-assigns
  // it) — read the flag off the RAW args for the cascade line.
  details.push(...accountCascadeLines({ ...parsed.data, deriveFromHoldings: rest.deriveFromHoldings === true }));
  if (details.length === 0) return base;
  return { ...base, details };
}

/**
 * Async preview. Without an auth context (or for any tool without enrichment) it
 * returns the pure formatter result unchanged. With a context it ALSO enriches:
 *   • propose_changes — live field-level from→to diff per edit + portfolio impact;
 *   • add_expense / update_expense / add_income / update_income /
 *     add_liability / update_liability / add_account / update_account — a dry-run
 *     row diff (zod + FK asserts, NO write) plus, for liabilities, the ownership
 *     cascade line(s) and, for accounts, the business / holdings / ownership
 *     cascade line(s); or the plain-language validation error when the payload is
 *     invalid.
 * All enrichment is best-effort — wrapped in try/catch so any load/parse/assert
 * failure degrades to the pure preview rather than blocking approval.
 */
export async function describeProposedWrite(
  call: ProposedWrite,
  ctx?: ForgeAuthContext,
): Promise<WritePreview> {
  const base = formatProposedWrite(call);
  if (!ctx) return base;

  try {
    if (call.name === "add_expense") {
      return await enrichAddExpense(base, call.args, ctx.clientId);
    }
    if (call.name === "update_expense") {
      return await enrichUpdateExpense(base, call.args, ctx);
    }
    if (call.name === "add_income") {
      return await enrichAddIncome(base, call.args, ctx.clientId);
    }
    if (call.name === "update_income") {
      return await enrichUpdateIncome(base, call.args, ctx);
    }
    if (call.name === "add_liability") {
      return await enrichAddLiability(base, call.args, ctx.clientId);
    }
    if (call.name === "update_liability") {
      return await enrichUpdateLiability(base, call.args, ctx);
    }
    if (call.name === "add_account") {
      return await enrichAddAccount(base, call.args, ctx.clientId, ctx.firmId);
    }
    if (call.name === "update_account") {
      return await enrichUpdateAccount(base, call.args, ctx);
    }
    if (call.name === "promote_to_base") {
      const scenarioId = str(call.args.scenarioId);
      if (!scenarioId) return base;
      const { effectiveTree: baseTree } = await loadEffectiveTree(ctx.clientId, ctx.firmId, "base", {});
      const [changes, groups] = await Promise.all([
        loadScenarioChanges(scenarioId),
        loadScenarioToggleGroups(scenarioId),
      ]);
      const plan = scenarioChangesToBaseWrites(baseTree, changes, groups, {});
      const lines: string[] = [
        ...plan.inserts.map((w) => `ADD ${w.kind}`),
        ...plan.updates.map((w) => `EDIT ${w.kind} ${w.id}`),
        ...plan.singletonUpdates.map((w) => `EDIT ${w.kind} (singleton)`),
        ...plan.removes.map((w) => `REMOVE ${w.kind} ${w.id}`),
      ];
      return {
        ...base,
        details: [
          ...(lines.length ? lines : ["(no field-level changes — base already matches this scenario)"]),
          "The current base is auto-snapshotted before applying (rollback point).",
          "WARNING: ALL other scenarios for this client are permanently deleted on approval.",
        ],
      };
    }
    if (call.name !== "propose_changes") return base;

    const a = call.args;
    const scenarioId = typeof a.scenarioId === "string" ? a.scenarioId : ctx.scenarioId;
    const changes = readChanges(a);
    if (changes.length === 0) return base;

    const { effectiveTree } = await loadEffectiveTree(
      ctx.clientId,
      ctx.firmId,
      scenarioId,
      {},
    );

    // Describe each change ONCE. For an edit whose live row resolves, the
    // enriched `field: from → to` line(s) REPLACE the pure formatter's
    // `undefined → to` line. Edits with no resolvable row, and add/remove
    // changes, fall back to the pure `describeChangeUnit` line.
    const details: string[] = [];
    for (const c of changes) {
      const enriched =
        c.opType === "edit" && c.desiredFields
          ? enrichedEditLines(effectiveTree, c)
          : null;
      if (enriched && enriched.length > 0) {
        details.push(...enriched);
      } else {
        details.push(describeProposedChange(c));
      }
    }

    // Combined end-of-plan portfolio impact of the proposed changes.
    const impact = computePortfolioImpact(effectiveTree, changes);
    if (impact != null) {
      const rounded = Math.round(impact);
      const sign = rounded >= 0 ? "+" : "−";
      details.push(
        `Moves end-of-plan portfolio by ${sign}$${Math.abs(rounded).toLocaleString()}.`,
      );
    }

    return { ...base, details };
  } catch {
    // Preview enrichment is best-effort; never throw / block approval.
    return base;
  }
}
