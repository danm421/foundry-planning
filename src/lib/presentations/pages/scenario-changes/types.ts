import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";

export type ChangeArea =
  | "Plan & Assumptions"
  | "Income"
  | "Expenses"
  | "Savings"
  | "Assets"
  | "Liabilities"
  | "Estate"
  | "Taxes";

export type ChangeOp = "add" | "remove" | "edit";

export interface ChangeRow {
  area: ChangeArea;
  what: string;
  op: ChangeOp;
  before: string;
  after: string;
  why: string;
}

/** A flat row, or a labeled cluster of rows sharing a toggle group. */
export type DisplayUnit =
  | { kind: "row"; row: ChangeRow }
  | { kind: "group"; label: string; rows: ChangeRow[] };

export interface ScenarioChangesOptions {
  title: string;
  showExplanations: boolean;
}

export interface ScenarioChangesPageData {
  title: string;
  subtitle: string;
  units: DisplayUnit[];
  showExplanations: boolean;
  /** True → render the empty state instead of the table. */
  isEmpty: boolean;
}

/**
 * Injected into BuildDataContext by the export route, only when the deck
 * includes the Scenario Changes page and the active ref is a live scenario.
 */
export interface ScenarioChangesContext {
  changes: ScenarioChange[];
  toggleGroups: ToggleGroup[];
  /** "income:<uuid>" → "Rental income" */
  targetNames: Record<string, string>;
  /** e.g. "your current plan" */
  baseLabel: string;
}
