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
  familyMembers,
  externalBeneficiaries,
  gifts,
  wills,
  entities,
} from "@/db/schema";
import {
  writeAccountChildren,
  writeLiabilityChildren,
  writeIncomeChildren,
  writeExpenseChildren,
  updateExpenseChildren,
  writeSavingsRuleChildren,
  writeTransferChildren,
  writeRothConversionChildren,
  writeReinvestmentChildren,
  writeWillChildren,
} from "./promote-child-writers";

/** Loosely-typed tx handle (Drizzle's tx callback param is not exported as a
 *  named type at our version). The executor passes the real tx through. */
export type PromoteTx = Parameters<
  Parameters<(typeof import("@/db"))["db"]["transaction"]>[0]
>[0];

/** Context threaded into child writers/updaters. `idRemap` maps synthetic add
 *  ids → DB-generated uuids; the executor inserts accounts first, so any
 *  same-batch account reference is already remapped by the time a dependent
 *  kind's writer runs. */
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

export interface RegistryEntry {
  table: PgTable;
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
  savings_rule: { table: savingsRules, childWriter: writeSavingsRuleChildren },
  withdrawal_strategy: { table: withdrawalStrategies },
  transfer: { table: transfers, childWriter: writeTransferChildren },
  reinvestment: { table: reinvestments, childWriter: writeReinvestmentChildren },
  asset_transaction: { table: assetTransactions },
  roth_conversion: { table: rothConversions, childWriter: writeRothConversionChildren },
  client_deduction: { table: clientDeductions },
  family_member: { table: familyMembers },
  external_beneficiary: { table: externalBeneficiaries },
  gift: { table: gifts },
  will: { table: wills, childWriter: writeWillChildren },
  entity: { table: entities },
};
