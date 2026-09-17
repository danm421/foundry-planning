import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { formatValue } from "../entity-table";
import { liabilityColumns, EMPTY_LIABILITY_COLUMNS_CONTEXT } from "../liabilities-columns";
import type { ExtractedLiability } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";

type Row = Annotated<ExtractedLiability>;

function liability(over: Partial<Row> = {}): Row {
  return { name: "Mortgage", ...over };
}

describe("formatValue date", () => {
  it("renders an ISO date as a short US date", () => {
    expect(formatValue("date", "2041-08-01")).toBe("Aug 1, 2041");
  });

  // Distinct from the assertion above: pins the UTC-parsing behaviour the
  // `isoDateText` docblock calls out (`new Date("2041-08-01")` in a
  // negative-offset local timezone would otherwise render the day before),
  // and a leap day specifically exercises real calendar math rather than a
  // string transform a naive implementation could fake.
  it("formats a leap-day date without an off-by-one from local timezone parsing", () => {
    expect(formatValue("date", "2024-02-29")).toBe("Feb 29, 2024");
  });

  // Both assertions pass via the early return at entity-table.tsx:212
  // (undefined/null/"" all short-circuit to "—" before the switch runs), not
  // via the `date` case — they would pass identically with no `date` case at
  // all. Kept because they pin that early return, and because they are
  // brief-mandated, not because they discriminate this task's change.
  it("renders an absent date as an em dash", () => {
    expect(formatValue("date", undefined)).toBe("—");
    expect(formatValue("date", "")).toBe("—");
  });

  // Also non-discriminating: pre-implementation "Q3 2026" fell through
  // `default` -> String(value) = "Q3 2026"; post-implementation it hits the
  // `date` case -> isoDateText, whose non-ISO branch also returns the value
  // verbatim. Same output either way. Kept because it pins the passthrough
  // behaviour itself (never "Invalid Date"), not because it proves the
  // `date` case exists.
  it("passes an unparseable date through rather than printing Invalid Date", () => {
    expect(formatValue("date", "Q3 2026")).toBe("Q3 2026");
  });
});

describe("liabilityColumns", () => {
  const columns = liabilityColumns(EMPTY_LIABILITY_COLUMNS_CONTEXT);

  it("declares the nine columns in the order the advisor reads them", () => {
    expect(columns.map((c) => c.header)).toEqual([
      "Name",
      "Balance",
      "As of",
      "Matures",
      "Rate",
      "P&I",
      "Escrow → property tax",
      "Property",
      "Match",
    ]);
  });

  it("totals the balance and nothing else", () => {
    expect(columns.filter((c) => c.total).map((c) => c.header)).toEqual(["Balance"]);
  });

  it("uses the date kind for both dates so neither prints raw ISO", () => {
    expect(columns.find((c) => c.header === "As of")?.kind).toBe("date");
    expect(columns.find((c) => c.header === "Matures")?.kind).toBe("date");
  });

  it("keys the rate column on a decimal fraction", () => {
    expect(columns.find((c) => c.header === "Rate")?.kind).toBe("rate");
  });
});

/**
 * The escrow column's `render` is the most novel logic in this task — a
 * delegation to `annualEscrow` (Resolution 1) sitting under four branches —
 * and nothing above exercises it: the assertions above only ever inspect
 * declared `header`/`kind`/`total`, which is configuration, not behaviour.
 * These call the column's `render` directly and inspect the returned React
 * element's own props/children (the module is `.ts` and builds elements
 * with `createElement`, so the tree is a plain object — no DOM needed).
 */
describe("liabilityColumns escrow render", () => {
  const columns = liabilityColumns(EMPTY_LIABILITY_COLUMNS_CONTEXT);
  const escrowColumn = columns.find((c) => c.header === "Escrow → property tax")!;
  const render = (row: Row) => escrowColumn.render!(row, { isCommitted: false });

  it("shows the annual escrow with the raw PITI beneath it when both payments are present", () => {
    const el = render(
      liability({ totalPayment: 3_163, monthlyPayment: 2_538 }),
    ) as ReactElement<{
      className: string;
      children: [ReactElement<{ children: string }>, ReactElement<{ children: string; className: string }>];
    }>;
    expect(el.props.className).toBe("flex flex-col items-end");
    const [annualLine, pitiLine] = el.props.children;
    expect(annualLine.props.children).toBe("$7,500/yr");
    expect(pitiLine.props.children).toBe("$3,163/mo PITI");
    expect(pitiLine.props.className).toBe("text-xs text-ink-3");
  });

  it("falls back to the raw monthly total when there is no P&I to net an escrow out of", () => {
    const el = render(
      liability({ totalPayment: 3_163, monthlyPayment: undefined }),
    ) as ReactElement<{ className: string; children: string }>;
    expect(el.props.className).toBe("text-ink-3");
    expect(el.props.children).toBe("$3,163/mo total");
  });

  it("renders an em dash when the statement gives no payment at all", () => {
    expect(render(liability({ totalPayment: undefined, monthlyPayment: undefined }))).toBe("—");
  });

  // Proves the delegation (Resolution 1) is load-bearing, not decorative. A
  // naive `(totalPayment - monthlyPayment) * 12` reimplementation computes
  // ~0.12 here, rounds it to 0, and treats 0 as a DEFINED annual figure —
  // printing "$0/yr", a claim the statement never made. Delegating to
  // `annualEscrow` returns undefined for a sub-$1 escrow instead, so the
  // cell takes the same "/mo total" fallback as the no-P&I case above.
  it("falls back to the raw monthly total rather than printing $0/yr for a sub-dollar escrow", () => {
    const el = render(
      liability({ totalPayment: 2_538.01, monthlyPayment: 2_538 }),
    ) as ReactElement<{ className: string; children: string }>;
    expect(el.props.className).toBe("text-ink-3");
    expect(el.props.children).toBe("$2,538/mo total");
  });
});
