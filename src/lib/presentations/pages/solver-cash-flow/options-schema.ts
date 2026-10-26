import { z } from "zod";

// `.default` so a deck saved with this page's earlier options (a year range)
// still parses — it prints the first plan year.
export const solverCashFlowOptionsSchema = z.object({
  /** The year the breakdown prints. Null → the first plan year, the year the
   *  Solver's Cash Flow tab opens on. */
  year: z.number().int().nullable().default(null),
});

export type SolverCashFlowOptions = z.infer<typeof solverCashFlowOptionsSchema>;

export const SOLVER_CASH_FLOW_OPTIONS_DEFAULT: SolverCashFlowOptions = { year: null };

export function summarizeSolverCashFlowOptions(o: SolverCashFlowOptions): string {
  return o.year == null ? "First plan year" : String(o.year);
}
