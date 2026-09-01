import { describe, it, expect } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { TaxSummaryChartPdf } from "../chart-pdf";
import type { TaxYearBar } from "@/lib/presentations/pages/tax-summary/aggregate";

/** The x-axis labels, in draw order, read straight off the element tree. */
function yearLabels(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(yearLabels);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  const kids = yearLabels(props.children);
  // Every axis label is a bare `'NN` string inside an SvgText.
  return typeof props.children === "string" && /^'\d{2}$/.test(props.children)
    ? [props.children]
    : kids;
}

function bars(from: number, count: number): TaxYearBar[] {
  return Array.from({ length: count }, (_, i) => ({
    year: from + i,
    federalOrdinary: 40_000,
    capGains: 5_000,
    state: 8_000,
    payroll: 2_000,
    total: 55_000,
  }));
}

describe("TaxSummaryChartPdf x-axis labels", () => {
  // The Sheskier deck printed '26…'74 against bars that ran to '84: the
  // evenly spaced run stopped wherever `i % every` last landed. The final
  // band must always carry its year.
  it("labels the last year over a 59-year horizon", () => {
    const data = bars(2026, 59);
    const labels = yearLabels(TaxSummaryChartPdf({ bars: data }));
    expect(labels.at(-1)).toBe("'84");
  });

  it("labels the first and last year at every horizon length", () => {
    for (const n of [1, 2, 7, 9, 17, 33, 41, 58, 59, 60, 90]) {
      const labels = yearLabels(TaxSummaryChartPdf({ bars: bars(2026, n) }));
      expect(labels[0], `first label at n=${n}`).toBe("'26");
      expect(labels.at(-1), `last label at n=${n}`).toBe(
        `'${String(2026 + n - 1).slice(2)}`,
      );
    }
  });

  // The pinned last band must not print on top of the neighbour the even run
  // would otherwise draw — that is how p.11 printed `'49'50`.
  it("never labels two adjacent bands on a long horizon", () => {
    const data = bars(2026, 59);
    const slot = (440 - 6) / 59;
    const minGap = Math.ceil(16 / slot);
    const labels = yearLabels(TaxSummaryChartPdf({ bars: data }));
    const drawn = data
      .map((b, i) => [i, `'${String(b.year).slice(2)}`] as const)
      .filter(([, l]) => labels.includes(l))
      .map(([i]) => i);
    for (let k = 1; k < drawn.length; k++) {
      expect(drawn[k] - drawn[k - 1], `gap before index ${drawn[k]}`).toBeGreaterThanOrEqual(
        minGap,
      );
    }
  });
});
