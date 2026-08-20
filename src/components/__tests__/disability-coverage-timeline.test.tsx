// @vitest-environment jsdom
/**
 * The disability coverage timeline.
 *
 * Every fixture here is fed through the REAL `resolveCoverage` rather than a
 * hand-built `ResolvedCoverage`, so the component and the engine cannot drift:
 * if the engine's seam tolerance or its days→months constant moves, these
 * tests move with it instead of silently asserting a stale shape.
 *
 * The two numbers worth naming:
 *  - The standard 13-week STD / 90-day LTD pairing leaves a ONE-DAY seam, which
 *    sits inside `CONTINUITY_TOLERANCE_MONTHS`. `seam` is therefore null and the
 *    "no warning" test needs no extra guard in the component.
 *  - Both bands round to $7,957 on these fixtures, which is why the amount
 *    assertion is `getAllByText(...)`, not `getByText`.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DisabilityCoverageTimeline } from "../disability-coverage-timeline";
import { resolveCoverage } from "@/engine/disability-benefits";
import { baseClient } from "@/engine/__tests__/fixtures";
import type { DisabilityPolicy } from "@/engine/types";

const policy = (over: Partial<DisabilityPolicy> = {}): DisabilityPolicy => ({
  id: "dp-1",
  name: "Group",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null },
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: 10_000,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: true,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "employer",
  ...over,
});

const cov = (p: DisabilityPolicy) => resolveCoverage(p, 159_135, 2028, baseClient, 2055);

describe("DisabilityCoverageTimeline", () => {
  it("labels the waiting period, both benefit bands, and their monthly amounts", () => {
    render(<DisabilityCoverageTimeline coverage={cov(policy())} />);
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
    expect(screen.getByText(/short-term/i)).toBeInTheDocument();
    expect(screen.getByText(/long-term/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$7,957/).length).toBeGreaterThan(0);
  });

  it("shows no gap warning for the standard 13-week / 90-day pairing", () => {
    render(<DisabilityCoverageTimeline coverage={cov(policy())} />);
    // Vacuity guard: a component that rendered nothing at all would also have
    // no alert, so this test passes against an empty stub unless it first
    // proves the timeline is genuinely on screen.
    expect(screen.getByTestId("coverage-bar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns about a real coverage gap and names its length", () => {
    const gapped = policy({
      longTerm: {
        eliminationDays: 180,
        benefitPct: 0.6,
        monthlyMax: 10_000,
        benefitPeriod: { mode: "to_age", age: 65 },
      },
    });
    render(<DisabilityCoverageTimeline coverage={cov(gapped)} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/2\.9 months with no benefit/i);
  });

  it("warns about an overlap and states the combined replacement", () => {
    const overlapped = policy({
      shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 26, monthlyMax: null },
    });
    render(<DisabilityCoverageTimeline coverage={cov(overlapped)} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/both policies pay/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/120% of earnings/i);
  });

  it("warns when the benefit period cannot be resolved", () => {
    const noDob = { ...baseClient, spouseDob: undefined };
    const c = resolveCoverage(policy({ insured: "spouse" }), 159_135, 2028, noDob, 2055);
    render(<DisabilityCoverageTimeline coverage={c} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/date of birth/i);
  });

  it("renders the warning alone — no bar, no NaN — when nothing resolves at all", () => {
    // LTD-only AND unresolvable: both windows are null, so the bar's span is 0
    // and every percentage would divide by zero. The bar must not render.
    const noDob = { ...baseClient, spouseDob: undefined };
    const c = resolveCoverage(
      policy({ insured: "spouse", shortTerm: null }),
      159_135,
      2028,
      noDob,
      2055,
    );
    const { container } = render(<DisabilityCoverageTimeline coverage={c} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/date of birth/i);
    expect(screen.queryByTestId("coverage-bar")).toBeNull();
    expect(container.innerHTML).not.toMatch(/NaN/);
  });
});
