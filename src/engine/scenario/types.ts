// src/engine/scenario/types.ts
import type { ClientData } from "@/engine/types";

export type OpType = "add" | "edit" | "remove";

/**
 * Every entity type a scenario can affect. The list is exhaustive — any new
 * overlayable entity must be added here AND in the engine's switch on
 * target_kind. Keep alphabetical for ease of review.
 */
export type TargetKind =
  | "account"
  | "asset_transaction"
  | "beneficiary_designation"
  | "client"
  | "client_deduction"
  | "entity"
  | "expense"
  | "expense_schedule_override"
  | "external_beneficiary"
  | "extra_payment"
  | "family_member"
  | "gift"
  | "income"
  | "income_schedule_override"
  | "liability"
  | "life_insurance_cash_value_schedule"
  | "life_insurance_policy"
  | "plan_settings"
  | "savings_rule"
  | "savings_schedule_override"
  | "transfer"
  | "transfer_schedule"
  | "will"
  | "will_bequest"
  | "will_bequest_recipient"
  | "withdrawal_strategy";

export interface ScenarioChange {
  id: string;
  scenarioId: string;
  opType: OpType;
  targetKind: TargetKind;
  /** For add: a fresh uuid invented by the scenario. For edit/remove: id of the base row. */
  targetId: string;
  /**
   * - add: full entity object (shape matches the engine's type for that targetKind)
   * - edit: { fieldName: { from, to } } map
   * - remove: null
   */
  payload: unknown;
  /** null = ungrouped (always active) */
  toggleGroupId: string | null;
  orderIndex: number;
}

export interface ToggleGroup {
  id: string;
  scenarioId: string;
  name: string;
  defaultOn: boolean;
  /** null = no parent dependency */
  requiresGroupId: string | null;
  orderIndex: number;
}

/** Map of toggleGroupId → on/off state. Missing keys default to the group's defaultOn. */
export type ToggleState = Record<string, boolean>;

export interface CascadeWarning {
  kind:
    | "transfer_dropped"
    | "savings_rule_dropped"
    | "beneficiary_reassigned"
    | "will_bequest_dropped"
    | "external_beneficiary_unreferenced";
  message: string;
  /** ID of the scenario_change row that caused the cascade (the remove change) */
  causedByChangeId: string;
  /** ID of the entity that was cleaned up */
  affectedEntityId: string;
  /** Human-readable label for the affected entity, e.g. "Transfer · Roth conversion 2027" */
  affectedEntityLabel: string;
}

export interface ApplyChangesResult {
  effectiveTree: ClientData;
  warnings: CascadeWarning[];
}
