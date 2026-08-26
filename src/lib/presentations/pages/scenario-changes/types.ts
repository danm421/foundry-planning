import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";
import type { ResolveContextData } from "./describe/resolve";

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
  /** Ordered fact segments shown in the DETAILS column (one rendered line each). */
  detail: string[];
}

/** A flat row, or a labeled cluster of rows sharing a toggle group. */
export type DisplayUnit =
  | { kind: "row"; row: ChangeRow }
  | { kind: "group"; label: string; rows: ChangeRow[] };

export interface ScenarioChangesOptions {
  /** The scenario whose edits are printed; the baseline is always Base Case.
   *  "" = unset, which blocks the export the same way the other comparison
   *  reports do. */
  scenarioId: string;
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
  /** Which empty state to print: no scenario picked yet, vs. a picked scenario
   *  that turned out to hold no edits. Absent when there is a table to print. */
  emptyReason?: "unselected" | "no-changes";
}

/**
 * Attached to the chosen scenario's bundle by the export route, only when the
 * deck includes the Plan Comparison page and that ref is a live scenario.
 */
export interface ScenarioChangesContext {
  changes: ScenarioChange[];
  toggleGroups: ToggleGroup[];
  /** "income:<uuid>" → "Rental income" */
  targetNames: Record<string, string>;
  /** e.g. "your current plan" */
  baseLabel: string;
  /** Resolution maps for rich detail; omitted → describers fall back to terse copy. */
  resolve?: ResolveContextData;
}
