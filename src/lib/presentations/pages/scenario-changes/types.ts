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
  /** True when `detail` only restates what `what` + `before`/`after` already
   *  say — a single-field edit's "Adjusts this expense.". The changes TABLE
   *  suppresses it (it has those columns); the Plan Story chapter still reads
   *  it (it has only `what` and `detail[0]`). Consumers that measure a row's
   *  height must apply the same rule the renderer does. */
  restatesRow?: true;
}

/**
 * The detail lines the changes TABLE prints for a row.
 *
 * A `restatesRow` detail is suppressed HERE AND ONLY HERE: the Plan Story
 * chapter reads `row.detail` directly, because it has no before/after columns
 * for the clause to restate.
 *
 * ⚠️ The renderer and `estimateScenarioChangesPageCount` must BOTH call this.
 * The estimator drives the Contents page numbers, so a renderer that hides a
 * line the estimator still measures shifts every entry after it — the same
 * failure that had "Tax Summary … 8" pointing at page 9.
 */
export function visibleDetail(row: ChangeRow, showDetails: boolean): string[] {
  if (!showDetails || row.restatesRow) return [];
  return row.detail;
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
 * deck includes the Plan Changes page and that ref is a live scenario.
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
