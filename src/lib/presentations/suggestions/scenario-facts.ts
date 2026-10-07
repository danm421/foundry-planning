// What a scenario changes, sorted into the change types the suggestion rules
// read, and how its projection moved against Base Case.
//
// Pure: change rows, the two trees and the two projections' facts in, a flat
// serializable record out. Server-only by import (engine values) — the
// panel's scoring modules import its TYPES, never its values.
//
// Edits are read field by field because whole-form saves record untouched
// fields (`{ to: null }` beside no `from`): an edit counts only for a field
// whose value really moved, so a re-saved account form changes nothing.
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";
import type { OpType, TargetKind, ToggleGroup } from "@/engine/scenario/types";
import type { ClientData } from "@/engine/types";
import { GROWTH_SETTINGS_KEYS } from "@/lib/scenario/growth-settings-override";
import type { ProjectedFacts } from "./plan-facts";

export type ChangeType =
  | "roth" | "retirementAge" | "planLength" | "socialSecurity" | "otherIncome" | "spending"
  | "savings" | "relocation" | "assetTransaction" | "gifts" | "estateDocs" | "entities"
  | "investments" | "stress" | "debts" | "insurance" | "taxSettings" | "withdrawalOrder" | "accounts";

/** One change type's tally, with what its reason line can name. The first
 *  change to carry a detail wins it. */
export interface ChangeDetail {
  count: number;
  /** Retirement age (whose, from, to) or Social Security claim age (from, to). */
  who?: string;
  fromAge?: number;
  toAge?: number;
  /** A move's, a sale's or a trust's own name; `id` only when a page can
   *  point at it in this plan. */
  name?: string;
  id?: string;
  year?: number;
  /** Long-term care, not a stress test — its costs show on Expenses. */
  ltc?: boolean;
  /** A transfer between accounts — Portfolio Activity shows it. */
  transfer?: boolean;
}

export type MovedTest =
  | "convertsMore" | "portfolio" | "tax" | "stateTax" | "irmaa" | "estate" | "gains" | "deductions" | "socialSecurity";

export interface ScenarioFacts {
  id: string;
  name: string;
  changeCount: number;
  changes: Partial<Record<ChangeType, ChangeDetail>>;
  /** Base Case's projected facts; null when Base Case couldn't be projected. */
  base: ProjectedFacts | null;
  /** The spec's "moved against Base Case" tests; all false without both sides. */
  moved: Record<MovedTest, boolean>;
}

export interface ChangeRow {
  opType: OpType;
  targetKind: TargetKind;
  targetId: string;
  payload: unknown;
  toggleGroupId: string | null;
}

// Fields an edit can move without changing anything a report shows.
const IGNORED_FIELDS = new Set([
  "name", "label", "notes", "description", "custodian", "accountNumberLast4", "countsTowardAum", "cashAccountId",
]);
const RETIREMENT_FIELDS: Record<string, "client" | "spouse"> = { retirementAge: "client", spouseRetirementAge: "spouse" };
const PLAN_LENGTH_FIELDS = new Set(["lifeExpectancy", "spouseLifeExpectancy", "planEndAge", "planEndYear"]);
const GROWTH_FIELDS = new Set<string>(GROWTH_SETTINGS_KEYS);
const TAX_SETTING_FIELDS = new Set(["taxEngineMode", "flatFederalRate", "flatStateRate"]);
const STRESS_FIELDS = new Set(["ssBenefitHaircut", "marketShock", "taxRateStress", "disabilityEvent"]);
const ACCOUNT_GROWTH_FIELDS = new Set(["growthRate", "growthSource", "modelPortfolioId"]);
const ACCOUNT_HOLDING_FIELDS = new Set(["value", "owners", "ownerEntityId", "category", "subType", "revocableTrustName"]);

const BY_KIND: Partial<Record<TargetKind, ChangeType>> = {
  roth_conversion: "roth",
  expense: "spending",
  expense_schedule_override: "spending",
  income_schedule_override: "otherIncome",
  savings_rule: "savings",
  savings_schedule_override: "savings",
  gift: "gifts",
  will: "estateDocs",
  will_bequest: "estateDocs",
  will_bequest_recipient: "estateDocs",
  external_beneficiary: "estateDocs",
  family_member: "estateDocs",
  beneficiary_designation: "estateDocs",
  reinvestment: "investments",
  stress_test: "stress",
  liability: "debts",
  extra_payment: "debts",
  disability_policy: "insurance",
  life_insurance_policy: "insurance",
  life_insurance_cash_value_schedule: "insurance",
  client_deduction: "taxSettings",
  client_tax_adjustment: "taxSettings",
  withdrawal_strategy: "withdrawalOrder",
};

function norm(v: unknown): unknown {
  if (v == null || v === "") return null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

/** The fields an edit really moved: a missing value and an empty one are the
 *  same, and "2027" is 2027. */
export function movedFields(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, v]) => {
      if (v == null || typeof v !== "object") return false;
      const { from, to } = v as { from?: unknown; to?: unknown };
      return norm(from) !== norm(to);
    })
    .map(([k]) => k);
}

/** The changes the projection actually applies under default toggles — the
 *  same filter `applyScenarioChanges` runs. */
export function activeChanges<T extends ChangeRow>(rows: T[], groups: ToggleGroup[]): T[] {
  const on = resolveEffectiveToggleState({}, groups);
  return rows.filter((r) => r.toggleGroupId == null || on[r.toggleGroupId] === true);
}

type Hit = { type: ChangeType; detail?: Omit<ChangeDetail, "count"> };

/** A blank age (a nullable field, an FRA-mode claim) is unknown, not 0. */
const age = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

function classify(row: ChangeRow, base: ClientData, plan: ClientData): Hit[] {
  const fields = row.opType === "edit" ? movedFields(row.payload) : [];
  if (row.opType === "edit" && fields.every((f) => IGNORED_FIELDS.has(f))) return [];
  const added = row.opType === "add" ? ((row.payload ?? {}) as Record<string, unknown>) : undefined;
  const edit = (field: string) => (row.payload as Record<string, { from?: unknown; to?: unknown }>)[field];
  const has = (set: Set<string>) => fields.some((f) => set.has(f));
  const byId = <T extends { id: string }>(rows: T[] | undefined) => rows?.find((r) => r.id === row.targetId);

  switch (row.targetKind) {
    case "client": {
      const hits: Hit[] = Object.entries(RETIREMENT_FIELDS)
        .filter(([field]) => fields.includes(field))
        .map(([field, who]) => ({
          type: "retirementAge",
          detail: {
            who: who === "client" ? plan.client.firstName : (plan.client.spouseName ?? "the co-client"),
            fromAge: age(edit(field).from),
            toAge: age(edit(field).to),
          },
        }));
      if (has(PLAN_LENGTH_FIELDS)) hits.push({ type: "planLength" });
      return hits;
    }
    case "plan_settings": {
      const hits: Hit[] = [];
      if (fields.includes("residenceState")) {
        hits.push({ type: "relocation", detail: { name: `Move to ${String(edit("residenceState").to)}` } });
      }
      if (has(PLAN_LENGTH_FIELDS)) hits.push({ type: "planLength" });
      if (has(GROWTH_FIELDS)) hits.push({ type: "investments" });
      if (has(TAX_SETTING_FIELDS)) hits.push({ type: "taxSettings" });
      if (has(STRESS_FIELDS)) hits.push({ type: "stress" });
      return hits;
    }
    case "income": {
      const type = added?.type ?? byId(base.incomes)?.type;
      if (type !== "social_security") return [{ type: "otherIncome" }];
      const claim = fields.includes("claimingAge") ? edit("claimingAge") : undefined;
      return [{ type: "socialSecurity", detail: claim ? { fromAge: age(claim.from), toAge: age(claim.to) } : undefined }];
    }
    case "account": {
      const category = added?.category ?? byId(base.accounts)?.category;
      if (category === "life_insurance") return [{ type: "insurance" }];
      if (row.opType !== "edit") return [{ type: "accounts" }];
      const hits: Hit[] = [];
      if (fields.some((f) => /^beneficiar/i.test(f))) hits.push({ type: "estateDocs" });
      if (has(ACCOUNT_GROWTH_FIELDS)) hits.push({ type: "investments" });
      if (has(ACCOUNT_HOLDING_FIELDS)) hits.push({ type: "accounts" });
      return hits;
    }
    case "relocation": {
      const r = (added as { name?: string; year?: number } | undefined) ?? byId(plan.relocations) ?? byId(base.relocations);
      return [{ type: "relocation", detail: { name: r?.name, year: r?.year } }];
    }
    case "asset_transaction": {
      const t = (added as { name?: string; year?: number } | undefined) ?? byId(plan.assetTransactions) ?? byId(base.assetTransactions);
      return [{ type: "assetTransaction", detail: { name: t?.name, year: t?.year } }];
    }
    case "entity": {
      const inPlan = byId(plan.entities);
      const named = inPlan ?? byId(base.entities) ?? (added as { name?: string } | undefined);
      return [{ type: "entities", detail: { id: inPlan?.id, name: named?.name ?? undefined } }];
    }
    case "ltc_event":
      return [{ type: "stress", detail: { ltc: true } }];
    case "transfer":
    case "transfer_schedule":
      return [{ type: "accounts", detail: { transfer: true } }];
    default: {
      const type = BY_KIND[row.targetKind];
      return type ? [{ type }] : [];
    }
  }
}

/** Drops keys whose value is undefined, so a detail compares and serializes cleanly. */
function defined<T extends object>(o: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function sortChanges(
  rows: ChangeRow[],
  baseTree: ClientData,
  planTree: ClientData,
): Partial<Record<ChangeType, ChangeDetail>> {
  const out: Partial<Record<ChangeType, ChangeDetail>> = {};
  for (const row of rows) {
    for (const hit of classify(row, baseTree, planTree)) {
      const prev = out[hit.type];
      const kept = defined(prev);
      delete kept.count;
      const incoming = defined(hit.detail);
      // One change's detail, whole: the first that has one. Only an entity
      // that is still in the plan (it has an id) beats one that was removed.
      const useIncoming = Object.keys(kept).length === 0 || (hit.type === "entities" && kept.id == null && incoming.id != null);
      out[hit.type] = { ...(useIncoming ? incoming : kept), count: (prev?.count ?? 0) + 1 };
    }
  }
  return out;
}

const NOTHING_MOVED: Record<MovedTest, boolean> = {
  convertsMore: false, portfolio: false, tax: false, stateTax: false, irmaa: false,
  estate: false, gains: false, deductions: false, socialSecurity: false,
};

export function movedTests(plan: ProjectedFacts | null, base: ProjectedFacts | null): Record<MovedTest, boolean> {
  if (!plan || !base) return NOTHING_MOVED;
  const gap = (a: number, b: number) => Math.abs(a - b);
  return {
    convertsMore: plan.rothConverted - base.rothConverted >= 1,
    portfolio:
      gap(plan.endingPortfolio, base.endingPortfolio) >= Math.max(50_000, 0.05 * Math.abs(base.endingPortfolio)) ||
      plan.depletionYear !== base.depletionYear,
    tax: gap(plan.lifetimeTax.total, base.lifetimeTax.total) >= 10_000,
    stateTax: gap(plan.lifetimeTax.state, base.lifetimeTax.state) >= 5_000,
    irmaa: gap(plan.irmaaTotal, base.irmaaTotal) >= 1_000,
    estate:
      gap(plan.estateTax, base.estateTax) >= 10_000 ||
      (base.grossEstate > 0 && gap(plan.grossEstate, base.grossEstate) >= 0.05 * base.grossEstate),
    gains: gap(plan.lifetimeTax.capitalGains, base.lifetimeTax.capitalGains) >= 5_000,
    deductions:
      gap(plan.aboveLineTotal, base.aboveLineTotal) >= 5_000 || gap(plan.belowLineTaken, base.belowLineTaken) >= 5_000,
    socialSecurity: plan.ssFirstYear !== base.ssFirstYear,
  };
}

export function buildScenarioFacts(input: {
  id: string;
  name: string;
  rows: ChangeRow[];
  baseTree: ClientData;
  planTree: ClientData;
  plan: ProjectedFacts | null;
  base: ProjectedFacts | null;
}): ScenarioFacts {
  return {
    id: input.id,
    name: input.name,
    changeCount: input.rows.length,
    changes: sortChanges(input.rows, input.baseTree, input.planTree),
    base: input.base,
    moved: movedTests(input.plan, input.base),
  };
}
