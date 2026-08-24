// A solver feature (debt paydown) was silently dropped once already by a
// save-to-base column list that had been lifted verbatim from a route and
// then not kept in sync (see solver-debt-paydown-technique-committed). This
// guards the same failure mode for `payment_month`: the route writes incomes
// and expenses through hand-enumerated column lists, which cannot pick up a
// new column by default.
//
// This is a source-text assertion, not a DB-backed one, because the failure
// mode IS a missing line in a column list — the route needs a live DB to
// exercise, but a live run would exercise whichever columns ARE listed and
// tell us nothing about the one that silently isn't.
//
// Four sites enumerate their columns and must each name paymentMonth:
//   1. tx.insert(incomes).values({...})          (new income rows)
//   2. tx.update(incomes).set({...})              (full income upsert)
//   3. tx.insert(expenses).values({...})          (new expense rows)
//   4. tx.update(expenses).set({...})             (full expense upsert)
//
// Two further sites are deliberately OUT of scope and must stay that way:
// the partial `.update(incomes)` / `.update(expenses)` loops spread a
// caller-supplied `set` object (`...set`), so they already carry any column
// automatically. Naming paymentMonth there would force the column onto every
// partial update instead of leaving it opt-in.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ROUTE = "src/app/api/clients/[id]/solver/save-to-base/route.ts";

// Isolates one `for (const ... of <iterableName>) { ... }` loop body. Every
// loop in this route is written back-to-back at the same 6-space indent, so
// the next `for (const` at that indent is a reliable end boundary regardless
// of what the loop body contains — this is what lets the assertion below
// pinpoint exactly which site is missing the field, rather than just noticing
// that the file as a whole mentions `paymentMonth:` somewhere.
function loopBody(src: string, iterableName: string): string {
  const anchor = new RegExp(`for \\(const [^)]*\\bof ${iterableName}\\) \\{`);
  const m = anchor.exec(src);
  if (!m) throw new Error(`loop "of ${iterableName}" not found in ${ROUTE}`);
  const bodyStart = m.index + m[0].length;
  const nextFor = src.indexOf("\n      for (const", bodyStart);
  return src.slice(bodyStart, nextFor === -1 ? src.length : nextFor);
}

describe("save-to-base carries paymentMonth through every enumerated column list", () => {
  const src = readFileSync(ROUTE, "utf8");

  it("names paymentMonth in the incomeInserts insert (site 1)", () => {
    expect(loopBody(src, "incomeInserts")).toMatch(/paymentMonth:/);
  });

  it("names paymentMonth in the incomeFullUpdates update (site 2)", () => {
    expect(loopBody(src, "incomeFullUpdates")).toMatch(/paymentMonth:/);
  });

  it("names paymentMonth in the expenseInserts insert (site 3)", () => {
    expect(loopBody(src, "expenseInserts")).toMatch(/paymentMonth:/);
  });

  it("names paymentMonth in the expenseFullUpdates update (site 4)", () => {
    expect(loopBody(src, "expenseFullUpdates")).toMatch(/paymentMonth:/);
  });
});
