// src/lib/scenario/promote-table-registry.ts
//
// Maps each overlayable array TargetKind to the base-case drizzle table its
// rows are written to. Singletons (client, plan_settings) and nested-only kinds
// (schedule overrides, life-insurance policy, will bequests, etc.) are NOT in
// this registry — singletons are UPDATEd directly by the executor and
// nested-only kinds only appear as children inside an add payload.
//
// NOTE: `gift` maps to the client-scoped `gifts` table (it has no scenarioId
// column). The newer scenario-scoped `gift_series` table is NOT a TargetKind —
// it is handled by the direct-copy path (promote-direct-tables.ts), not here.
import type { PgTable } from "drizzle-orm/pg-core";
import type { TargetKind } from "@/engine/scenario/types";
import {
  accounts,
  incomes,
  expenses,
  liabilities,
  savingsRules,
  withdrawalStrategies,
  transfers,
  reinvestments,
  assetTransactions,
  rothConversions,
  clientDeductions,
  clientTaxAdjustments,
  familyMembers,
  externalBeneficiaries,
  gifts,
  wills,
  entities,
  relocations,
} from "@/db/schema";
import {
  writeAccountChildren,
  writeLiabilityChildren,
  writeIncomeChildren,
  writeExpenseChildren,
  updateExpenseChildren,
  writeSavingsRuleChildren,
  updateSavingsRuleChildren,
  writeTransferChildren,
  writeRothConversionChildren,
  writeReinvestmentChildren,
  writeWillChildren,
  writeGiftChildren,
} from "./promote-child-writers";
import { translateGiftDraftForPromote } from "./promote-gift-translate";

/** Loosely-typed tx handle (Drizzle's tx callback param is not exported as a
 *  named type at our version). The executor passes the real tx through. */
export type PromoteTx = Parameters<
  Parameters<(typeof import("@/db"))["db"]["transaction"]>[0]
>[0];

/** Context threaded into child writers/updaters. `idRemap` maps synthetic add
 *  ids → DB-generated uuids; the executor inserts kinds in FK order (recipients
 *  and family members, then accounts, then incomes and liabilities — see
 *  `INSERT_RANK` in execute-base-write-plan.ts), so any same-batch reference to
 *  one of those is already remapped by the time a dependent kind's writer runs. */
export interface ChildWriterCtx {
  clientId: string;
  baseScenarioId: string;
  idRemap: Map<string, string>;
}

/** A child writer inserts the nested rows of an add payload after the parent
 *  row exists. parentId is the DB-generated parent uuid. Implemented in Task 7. */
export type ChildWriter = (
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
  ctx: ChildWriterCtx,
) => Promise<void>;

/** Reshapes an add payload into the parent table's column shape BEFORE
 *  `coerceForTable` drops every key that isn't a column name. Only needed where
 *  a scenario change stores an editor DRAFT rather than a row — today `gift`
 *  alone. Absent everywhere else, which is what keeps the executor's behaviour
 *  for the other kinds unchanged. */
export type PayloadTranslator = (
  raw: Record<string, unknown>,
) => Record<string, unknown>;

export interface RegistryEntry {
  table: PgTable;
  translate?: PayloadTranslator;
  /** Write the add under the id the change names instead of letting the DB mint
   *  a fresh one, UPDATING that row when it already exists. Only for kinds whose
   *  `add` doubles as an edit of an existing base row — today `gift` alone,
   *  which has no `edit` op, so a save of a base-plan gift arrives as an `add`
   *  on that gift's own id. Every other kind's add is genuinely new and its
   *  targetId is a synthetic uuid, so they must keep the generated id. */
  preserveId?: boolean;
  childWriter?: ChildWriter;
  /** Rewrites child rows after an EDIT to the parent. Receives the edit's
   *  `set` (the diff's `to` values) instead of an add payload; the executor
   *  only calls it when the parent UPDATE matched a base row. */
  childUpdater?: ChildWriter;
}

/** Kinds that only ever appear nested inside a parent add payload. */
export const NESTED_ONLY_KINDS = new Set<TargetKind>([
  "beneficiary_designation",
  "expense_schedule_override",
  "extra_payment",
  "income_schedule_override",
  "life_insurance_cash_value_schedule",
  "life_insurance_policy",
  "savings_schedule_override",
  "transfer_schedule",
  "will_bequest",
  "will_bequest_recipient",
]);

export const PROMOTE_TABLE_REGISTRY: Partial<Record<TargetKind, RegistryEntry>> = {
  account: { table: accounts, childWriter: writeAccountChildren },
  income: { table: incomes, childWriter: writeIncomeChildren },
  expense: {
    table: expenses,
    childWriter: writeExpenseChildren,
    childUpdater: updateExpenseChildren,
  },
  liability: { table: liabilities, childWriter: writeLiabilityChildren },
  savings_rule: {
    table: savingsRules,
    childWriter: writeSavingsRuleChildren,
    childUpdater: updateSavingsRuleChildren,
  },
  withdrawal_strategy: { table: withdrawalStrategies },
  transfer: { table: transfers, childWriter: writeTransferChildren },
  reinvestment: { table: reinvestments, childWriter: writeReinvestmentChildren },
  asset_transaction: { table: assetTransactions },
  roth_conversion: { table: rothConversions, childWriter: writeRothConversionChildren },
  client_deduction: { table: clientDeductions },
  client_tax_adjustment: { table: clientTaxAdjustments },
  family_member: { table: familyMembers },
  external_beneficiary: { table: externalBeneficiaries },
  gift: {
    table: gifts,
    translate: translateGiftDraftForPromote,
    preserveId: true,
    // An asset gift on an account with a linked liability carries a bundled
    // liability-transfer child row, exactly as the gift route creates one.
    // Without it the mortgage stops following the property at promote.
    childWriter: writeGiftChildren,
  },
  will: { table: wills, childWriter: writeWillChildren },
  entity: { table: entities },
  relocation: { table: relocations },
};
