// src/lib/solver/types.ts
//
// Public types shared between the solver UI, API routes, and pure helpers.
// Lives in `src/lib/solver/` so it stays framework-free (no Next, no DB).

import type {
  ClientData,
  ProjectionYear,
  RothConversion,
  AssetTransaction,
  Reinvestment,
  Account,
  Liability,
  Income,
  Expense,
  SavingsRule,
  ExternalBeneficiary,
  EntitySummary,
  Relocation,
  Will,
} from "@/engine/types";
import type { NoteReceivable } from "@/engine/notes-receivable/types";
import type { ProjectionResult } from "@/engine";
import type { IncomeTaxType } from "@/engine/tax-adjustments";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { DebtPaydownRow } from "./debt-paydown";

export type SolverPerson = "client" | "spouse";

export type SsBenefitMode = "pia_at_fra" | "manual_amount" | "no_benefit";
export type SsClaimAgeMode = "fra" | "at_retirement" | "years";

export type SavingsGrowthSource = "custom" | "inflation";

/** Re-export of the engine's canonical union. The solver UI once carried its own
 *  copy; the copies are what let income rows and tax adjustments disagree about
 *  what `tax_exempt` meant. One definition, in `@/engine/tax-adjustments`. */
export type { IncomeTaxType };

export type SolverMutation =
  | { kind: "retirement-age"; person: SolverPerson; age: number; month?: number }
  | { kind: "living-expense-scale"; multiplier: number }
  | { kind: "living-expense-amount"; amount: number }
  | { kind: "expense-annual-amount"; expenseId: string; annualAmount: number }
  /** The current living row spends the household's entire remaining cash flow;
   *  its annual amount becomes an optional floor. A lever of its own so it
   *  composes with the amount stepper instead of clobbering it. */
  | { kind: "expense-absorbs-remaining"; expenseId: string; value: boolean }
  | { kind: "income-annual-amount"; incomeId: string; annualAmount: number }
  | { kind: "income-growth-rate"; incomeId: string; rate: number }
  | { kind: "income-growth-source"; incomeId: string; source: SavingsGrowthSource }
  | { kind: "income-tax-type"; incomeId: string; taxType: IncomeTaxType }
  | { kind: "income-self-employment"; incomeId: string; value: boolean }
  | { kind: "income-start-year"; incomeId: string; year: number }
  | { kind: "income-end-year"; incomeId: string; year: number }
  | { kind: "ss-claim-age"; person: SolverPerson; age: number; months?: number }
  | { kind: "ss-claim-age-mode"; person: SolverPerson; mode: SsClaimAgeMode }
  | { kind: "ss-benefit-mode"; person: SolverPerson; mode: SsBenefitMode }
  | { kind: "ss-pia-monthly"; person: SolverPerson; amount: number }
  | { kind: "ss-annual-amount"; person: SolverPerson; amount: number }
  | { kind: "ss-cola"; person: SolverPerson; rate: number }
  | { kind: "savings-contribution"; accountId: string; annualAmount: number }
  | { kind: "savings-annual-percent"; accountId: string; percent: number | null }
  /** Which salaries a percent-of-salary contribution (and a percent employer
   *  match) resolves against. The union is spelled out rather than importing
   *  Task 4's `SalaryBasis` — lib/solver must not depend on a component module. */
  | {
      kind: "savings-salary-basis";
      accountId: string;
      basis: "owner" | "all" | "selected";
      incomeIds: string[];
    }
  | { kind: "savings-roth-percent"; accountId: string; rothPercent: number }
  | { kind: "savings-contribute-max"; accountId: string; value: boolean }
  | { kind: "savings-growth-rate"; accountId: string; rate: number }
  | { kind: "savings-growth-source"; accountId: string; source: SavingsGrowthSource }
  | { kind: "savings-deductible"; accountId: string; value: boolean }
  | { kind: "savings-apply-cap"; accountId: string; value: boolean }
  | {
      kind: "savings-employer-match-pct";
      accountId: string;
      pct: number;
      cap: number | null;
    }
  | { kind: "savings-employer-match-amount"; accountId: string; amount: number }
  /** `ref` is the milestone the year is anchored to ("client_retirement", …),
   *  or null for a hand-typed calendar year. Typed as a plain string to match
   *  `SavingsRule.startYearRef` in the engine, which is deliberately opaque
   *  there; the wire schema narrows it to the twelve real anchors. The resolved
   *  year is what the engine reads — the ref is what re-anchors the saved rule
   *  when the household's retirement date later moves. */
  | { kind: "savings-start-year"; accountId: string; year: number; ref?: string | null }
  | { kind: "savings-end-year"; accountId: string; year: number; ref?: string | null }
  | { kind: "life-expectancy"; person: SolverPerson; age: number }
  | { kind: "roth-conversion-upsert"; id: string; value: RothConversion | null }
  | { kind: "asset-transaction-upsert"; id: string; value: AssetTransaction | null }
  | { kind: "reinvestment-upsert"; id: string; value: Reinvestment | null }
  | { kind: "relocation-upsert"; id: string; value: Relocation | null }
  /** Extra principal thrown at one loan. Identity is the liability — a loan
   *  carries at most one paydown. `null` clears it. */
  | { kind: "debt-paydown"; liabilityId: string; value: DebtPaydownRow | null }
  | {
      kind: "account-upsert";
      id: string;
      value: Account | null;
      /**
       * The trust whose DISSOLVE produced this mutation, when it came from
       * `buildDissolveTrustMutations`. DECLARED, not inferred: a retitle out of
       * a trust is byte-identical to any other owner change, and a returned
       * income is byte-identical to any other income edit — nothing in the
       * payload says which advisor action it belongs to.
       *
       * `partitionBaseSavableMutations` reads it to hold this mutation back
       * whenever the paired `entity-upsert: null` is held, which it always is.
       * Without it Save-to-base posts the retitles and holds the rest, and the
       * client's REAL record ends up with the trust's accounts titled to the
       * grantor while the trust still exists, the will still names it, and the
       * gifts to it remain.
       *
       * Solver-wire only — never written to any column. Optional so an in-flight
       * client payload still saves, and so these kinds stay base-savable on
       * their own: `account-upsert` is the solver's most common mutation and
       * listing the KIND as non-savable would kill base saves across the
       * product.
       */
      dissolvedEntityId?: string;
    }
  /** A liability retitled into or out of a trust from the estate dialog's
   *  Assets tab. `null` removes the row. */
  | { kind: "liability-upsert"; id: string; value: Liability | null }
  | {
      kind: "income-upsert";
      id: string;
      value: Income | null;
      /** See `dissolvedEntityId` on `account-upsert`. */
      dissolvedEntityId?: string;
    }
  | {
      kind: "expense-upsert";
      id: string;
      value: Expense | null;
      /** See `dissolvedEntityId` on `account-upsert`. */
      dissolvedEntityId?: string;
    }
  | { kind: "savings-rule-upsert"; id: string; value: SavingsRule | null }
  | { kind: "gift-upsert";                 id: string; value: EstateFlowGift | null }
  | { kind: "external-beneficiary-upsert"; id: string; value: ExternalBeneficiary | null }
  | { kind: "entity-upsert";               id: string; value: EntitySummary | null }
  /** A grantor's will, edited from the estate dialog. Today the only writer is
   *  the dissolve-trust lever, which strips bequest and residuary recipients
   *  that named the trust it is removing — an orphaned bequest pays to an
   *  entity that no longer exists. `null` removes the will. */
  | { kind: "will-upsert";                 id: string; value: Will | null }
  /** A trust's per-year income/expense/distribution figures from the Flows
   *  tab. Keyed on (entityId, year) to match entity_flow_overrides' unique
   *  index. `null` clears the year back to base+growth. */
  | {
      kind: "entity-flow-override-upsert";
      entityId: string;
      year: number;
      value: {
        incomeAmount: number | null;
        expenseAmount: number | null;
        distributionPercent: number | null;
      } | null;
    }
  /** A promissory note from an intra-family sale to a trust (an IDGT
   *  installment sale), edited from the trust editor's Notes & sales tab.
   *  `null` removes the row. */
  | {
      kind: "note-receivable-upsert";
      id: string;
      value: NoteReceivable | null;
      /**
       * The account this note was created by selling, when the note came from
       * the trust dialog's sale-to-trust action. DECLARED, not inferred: the
       * save route pairs the note with that account's owner-flip change so the
       * two halves of one sale share a toggle group. Inferring the pairing from
       * `linkedTrustEntityId` + the account's new owners mis-pairs two sales to
       * the same trust and cannot tell a sale's retitle from a plain revocable-
       * trust funding retitle, which produces a byte-identical `owners` shape.
       *
       * Solver-wire only — it is never written to `notes_receivable`. Optional
       * so an in-flight client payload still saves (the note then gets its own
       * toggle group, as every note did before).
       */
      sourceAccountId?: string;
    }
  | { kind: "stress-inflation"; rate: number }
  | { kind: "stress-ss-haircut"; pct: number; startYear: number }
  | { kind: "stress-disability"; person: SolverPerson; startYear: number; endYear: number | null }
  | { kind: "stress-market-crash"; year: number; drawdownPct: number }
  | { kind: "stress-exemption-cap"; cap: number }
  | { kind: "stress-tax-rates"; points: number; startYear: number }
  | {
      kind: "surplus-allocation";
      spendPct: number;
      saveAccountId: string | null;
      /** Force 100% spend for every year before the first retirement year. */
      spendAllUntilRetirement: boolean;
    };

/** Stable key for "last write per lever wins" upsert semantics. */
export type SolverMutationKey =
  | `retirement-age:${SolverPerson}`
  | "living-expense-scale"
  | "living-expense-amount"
  | `expense-annual-amount:${string}`
  | `expense-absorbs-remaining:${string}`
  | `income-annual-amount:${string}`
  | `income-growth-rate:${string}`
  | `income-growth-source:${string}`
  | `income-tax-type:${string}`
  | `income-self-employment:${string}`
  | `income-start-year:${string}`
  | `income-end-year:${string}`
  | `ss-claim-age:${SolverPerson}`
  | `ss-claim-age-mode:${SolverPerson}`
  | `ss-benefit-mode:${SolverPerson}`
  | `ss-pia-monthly:${SolverPerson}`
  | `ss-annual-amount:${SolverPerson}`
  | `ss-cola:${SolverPerson}`
  | `savings-contribution:${string}`
  | `savings-annual-percent:${string}`
  | `savings-salary-basis:${string}`
  | `savings-roth-percent:${string}`
  | `savings-contribute-max:${string}`
  | `savings-growth-rate:${string}`
  | `savings-growth-source:${string}`
  | `savings-deductible:${string}`
  | `savings-apply-cap:${string}`
  | `savings-employer-match-pct:${string}`
  | `savings-employer-match-amount:${string}`
  | `savings-start-year:${string}`
  | `savings-end-year:${string}`
  | `life-expectancy:${SolverPerson}`
  | `roth-conversion-upsert:${string}`
  | `asset-transaction-upsert:${string}`
  | `reinvestment-upsert:${string}`
  | `relocation-upsert:${string}`
  | `debt-paydown:${string}`
  | `account-upsert:${string}`
  | `liability-upsert:${string}`
  | `income-upsert:${string}`
  | `expense-upsert:${string}`
  | `savings-rule-upsert:${string}`
  | `gift-upsert:${string}`
  | `external-beneficiary-upsert:${string}`
  | `entity-upsert:${string}`
  | `will-upsert:${string}`
  | `entity-flow-override-upsert:${string}:${number}`
  | `note-receivable-upsert:${string}`
  | "stress-inflation"
  | "stress-ss-haircut"
  | "stress-disability"
  | "stress-market-crash"
  | "stress-exemption-cap"
  | "stress-tax-rates"
  | "surplus-allocation";

export function mutationKey(m: SolverMutation): SolverMutationKey {
  switch (m.kind) {
    case "retirement-age":
      return `retirement-age:${m.person}`;
    case "living-expense-scale":
      return "living-expense-scale";
    case "living-expense-amount":
      return "living-expense-amount";
    case "expense-annual-amount":
      return `expense-annual-amount:${m.expenseId}`;
    case "expense-absorbs-remaining":
      return `expense-absorbs-remaining:${m.expenseId}`;
    case "income-annual-amount":
      return `income-annual-amount:${m.incomeId}`;
    case "income-growth-rate":
      return `income-growth-rate:${m.incomeId}`;
    case "income-growth-source":
      return `income-growth-source:${m.incomeId}`;
    case "income-tax-type":
      return `income-tax-type:${m.incomeId}`;
    case "income-self-employment":
      return `income-self-employment:${m.incomeId}`;
    case "income-start-year":
      return `income-start-year:${m.incomeId}`;
    case "income-end-year":
      return `income-end-year:${m.incomeId}`;
    case "ss-claim-age":
      return `ss-claim-age:${m.person}`;
    case "ss-claim-age-mode":
      return `ss-claim-age-mode:${m.person}`;
    case "ss-benefit-mode":
      return `ss-benefit-mode:${m.person}`;
    case "ss-pia-monthly":
      return `ss-pia-monthly:${m.person}`;
    case "ss-annual-amount":
      return `ss-annual-amount:${m.person}`;
    case "ss-cola":
      return `ss-cola:${m.person}`;
    case "savings-contribution":
      return `savings-contribution:${m.accountId}`;
    case "savings-annual-percent":
      return `savings-annual-percent:${m.accountId}`;
    case "savings-salary-basis":
      return `savings-salary-basis:${m.accountId}`;
    case "savings-roth-percent":
      return `savings-roth-percent:${m.accountId}`;
    case "savings-contribute-max":
      return `savings-contribute-max:${m.accountId}`;
    case "savings-growth-rate":
      return `savings-growth-rate:${m.accountId}`;
    case "savings-growth-source":
      return `savings-growth-source:${m.accountId}`;
    case "savings-deductible":
      return `savings-deductible:${m.accountId}`;
    case "savings-apply-cap":
      return `savings-apply-cap:${m.accountId}`;
    case "savings-employer-match-pct":
      return `savings-employer-match-pct:${m.accountId}`;
    case "savings-employer-match-amount":
      return `savings-employer-match-amount:${m.accountId}`;
    case "savings-start-year":
      return `savings-start-year:${m.accountId}`;
    case "savings-end-year":
      return `savings-end-year:${m.accountId}`;
    case "life-expectancy":
      return `life-expectancy:${m.person}`;
    case "roth-conversion-upsert":
      return `roth-conversion-upsert:${m.id}`;
    case "asset-transaction-upsert":
      return `asset-transaction-upsert:${m.id}`;
    case "reinvestment-upsert":
      return `reinvestment-upsert:${m.id}`;
    case "relocation-upsert":
      return `relocation-upsert:${m.id}`;
    case "debt-paydown":
      return `debt-paydown:${m.liabilityId}`;
    case "account-upsert":
      return `account-upsert:${m.id}`;
    case "liability-upsert":
      return `liability-upsert:${m.id}`;
    case "income-upsert":
      return `income-upsert:${m.id}`;
    case "expense-upsert":
      return `expense-upsert:${m.id}`;
    case "savings-rule-upsert":
      return `savings-rule-upsert:${m.id}`;
    case "gift-upsert":
      return `gift-upsert:${m.id}`;
    case "external-beneficiary-upsert":
      return `external-beneficiary-upsert:${m.id}`;
    case "entity-upsert":
      return `entity-upsert:${m.id}`;
    case "will-upsert":
      return `will-upsert:${m.id}`;
    case "entity-flow-override-upsert":
      return `entity-flow-override-upsert:${m.entityId}:${m.year}`;
    case "note-receivable-upsert":
      return `note-receivable-upsert:${m.id}`;
    case "stress-inflation":
      return "stress-inflation";
    case "stress-ss-haircut":
      return "stress-ss-haircut";
    case "stress-disability":
      return "stress-disability";
    case "stress-market-crash":
      return "stress-market-crash";
    case "stress-exemption-cap":
      return "stress-exemption-cap";
    case "stress-tax-rates":
      return "stress-tax-rates";
    case "surplus-allocation":
      return "surplus-allocation";
  }
}

/**
 * Identifies which scenario the right column of the solver loaded from.
 * "base" = the pristine base plan. Otherwise, a saved scenario uuid.
 */
export type SolverSource = "base" | string;

/** Body shape of POST /api/clients/[id]/solver/project. */
export interface SolverProjectRequest {
  source: SolverSource;
  mutations: SolverMutation[];
  /** Set by the Estate summary to receive the full `projectionResult`. */
  includeEvents?: boolean;
}

export interface SolverProjectResponse {
  projection: ProjectionYear[];
  /** Present only when the request set `includeEvents: true` (Estate summary). */
  projectionResult?: ProjectionResult;
}

/** Body shape of POST /api/clients/[id]/solver/save-scenario.
 *  Phase 1 has no notes field — the scenarios table doesn't carry one and
 *  the advisor can add notes via the existing scenario editing UI later. */
export interface SolverSaveRequest {
  source: SolverSource;
  mutations: SolverMutation[];
  name: string;
}

export interface SolverSaveResponse {
  scenarioId: string;
}

/** Internal: a single scenarioChanges row to be inserted, sans scenarioId
 *  (the route fills that in once the new scenarios row exists). */
export interface SolverScenarioChangeDraft {
  opType: "add" | "edit" | "remove";
  targetKind: "client" | "plan_settings" | "account" | "income" | "expense" | "savings_rule" | "roth_conversion" | "asset_transaction" | "reinvestment" | "gift" | "external_beneficiary" | "entity" | "relocation" | "liability" | "will";
  targetId: string;
  /** edit: { field: { from, to } } map. add: full entity. remove: null. */
  payload: unknown;
  orderIndex: number;
}

/** Type guard re-export for `ClientData` so consumers don't need a second import. */
export type { ClientData };
