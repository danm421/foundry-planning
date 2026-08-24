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

/** A 26-week STD against the standard 90-day LTD — the two layers overlap by
 *  3.0 months. */
const overlapping = () =>
  policy({ shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 26, monthlyMax: null } });

const cov = (p: DisabilityPolicy) => resolveCoverage(p, 159_135, 2028, baseClient, 2055);

const barOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="coverage-bar"]') as HTMLElement;

describe("DisabilityCoverageTimeline", () => {
  it("labels the waiting period, both benefit bands, and their monthly amounts", () => {
    render(<DisabilityCoverageTimeline coverage={cov(policy())} />);
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
    expect(screen.getByText(/short-term/i)).toBeInTheDocument();
    expect(screen.getByText(/long-term/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$7,957/).length).toBeGreaterThan(0);
  });

  it("stacks short-term on the top lane and long-term on the bottom lane", () => {
    // The lane split is the component's one layout promise: where the layers
    // overlap the advisor must see two simultaneous payments, not one band
    // interrupting another. jsdom has no layout engine, so the only honest
    // handle is the geometry classes React actually emits.
    const { container } = render(<DisabilityCoverageTimeline coverage={cov(overlapping())} />);
    const bar = barOf(container);
    const shortTerm = bar.querySelector(".bg-data-blue") as HTMLElement;
    const longTerm = bar.querySelector(".bg-data-teal") as HTMLElement;
    expect(shortTerm.className).toContain("top-0");
    expect(shortTerm.className).toContain("h-1/2");
    expect(longTerm.className).toContain("bottom-0");
    expect(longTerm.className).toContain("h-1/2");
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
    render(<DisabilityCoverageTimeline coverage={cov(overlapping())} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/both layers pay/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/120% of earnings/i);
  });

  it("states no replacement rate when there are no covered earnings to divide by", () => {
    // `coveredEarnings === 0` is reachable, not theoretical: in salary mode
    // `resolveCoveredEarnings` returns 0 whenever the insured has no salary rows
    // (a non-earning spouse), and manual mode accepts a deliberate 0. The windows
    // are gated on the policy sections and the benefit period, never on earnings —
    // so they still exist and still overlap while every band pays $0/mo. Saying
    // "both layers pay ... a combined 0% of earnings" there is nonsense.
    const { container } = render(
      <DisabilityCoverageTimeline coverage={resolveCoverage(overlapping(), 0, 2028, baseClient, 2055)} />,
    );
    expect(container.textContent).not.toMatch(/% of earnings/);
    expect(screen.getByRole("alert")).toHaveTextContent(/no covered earnings/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/both layers pay/i);
  });

  it("blames only long-term coverage when the benefit period cannot be resolved", () => {
    // Missing DOB kills the LONG-TERM layer alone — `resolveCoverage` builds the
    // short-term window without ever consulting a date of birth, and
    // `benefitForYear` genuinely pays it ($21,958.67 in 2028 on this fixture).
    // A warning that says the policy pays nothing contradicts the band above it.
    const noDob = { ...baseClient, spouseDob: undefined };
    const c = resolveCoverage(policy({ insured: "spouse" }), 159_135, 2028, noDob, 2055);
    render(<DisabilityCoverageTimeline coverage={c} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/date of birth/i);
    expect(alert).toHaveTextContent(/long-term coverage pays nothing/i);
    expect(alert).not.toHaveTextContent(/it pays nothing/i);
    // …and the short-term layer is still on screen, still paying.
    expect(screen.getByText(/short-term/i)).toBeInTheDocument();
    expect(screen.getByText("$7,957/mo")).toBeInTheDocument();
  });

  it("reports the zero earnings, not the missing date of birth, when both are true", () => {
    // Precedence is by how many layers the condition stops paying, not by which
    // reads worse. A missing DOB kills long-term alone; zero covered earnings
    // kills BOTH — every band on the bar pays $0. Reported the other way round
    // (the shipped order) an advisor with a spouse who has neither a date of
    // birth nor salary rows was told a date of birth fixes it. Adding one leaves
    // the policy paying nothing and only THEN surfaces the real cause.
    const noDob = { ...baseClient, spouseDob: undefined };
    const c = resolveCoverage(policy({ insured: "spouse" }), 0, 2028, noDob, 2055);
    expect(c.unresolved).toBe("missing_dob"); // both conditions genuinely hold
    expect(c.coveredEarnings).toBe(0);

    const { container } = render(<DisabilityCoverageTimeline coverage={c} />);
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(/no covered earnings/i);
    expect(alerts[0]).not.toHaveTextContent(/date of birth/i);
    // The short-term band is on screen paying $0, which is what the alert now
    // explains — nothing about it is fixed by a date of birth.
    expect(screen.getByText("$0/mo")).toBeInTheDocument();
  });

  it("still reports the missing date of birth when NO layer resolved at all", () => {
    // The `shortTerm !== null || longTerm !== null` guard's whole job. Long-term
    // only and unresolvable: there is no $0 band on screen to explain, so the
    // thing actually missing is what the advisor needs — and this is the case
    // the earnings-first ordering had to leave untouched.
    const noDob = { ...baseClient, spouseDob: undefined };
    const c = resolveCoverage(
      policy({ insured: "spouse", shortTerm: null }),
      0,
      2028,
      noDob,
      2055,
    );
    render(<DisabilityCoverageTimeline coverage={c} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/date of birth/i);
  });

  it("hands the coverage warning's live region to a more blocking host alert", () => {
    // A screen may hold at most ONE role="alert". The dialog renders a failed
    // save above this component; the warning stays visible and steps down.
    const c = resolveCoverage(overlapping(), 0, 2028, baseClient, 2055);
    const { container } = render(
      <DisabilityCoverageTimeline coverage={c} alertRole="status" />,
    );
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(/no covered earnings/i);
  });

  it("renders the warning alone — no bar, no NaN — when nothing resolves at all", () => {
    // LTD-only AND unresolvable: both windows are null, so the bar's span is 0
    // and every percentage would divide by zero. The bar must not render.
    // The garbage an unguarded render emits is "Infinity days" in the waiting
    // legend, which is textContent — jsdom drops an invalid `left: NaN%`
    // declaration outright, so it never reaches innerHTML either.
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
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("clips a 336-month benefit period to the bar without overflowing it", () => {
    // A lifetime benefit period runs to plan end — 336 months here, well past
    // MAX_BAR_MONTHS. The band must be clamped PER VALUE (clamping the width
    // alone leaves `left` outside the clamp and the band runs past the track),
    // the bar gets a "…" cap, and the legend must still name the TRUE end month
    // so a screen reader is not handed the truncated figure.
    const lifetime = policy({
      longTerm: {
        eliminationDays: 90,
        benefitPct: 0.6,
        monthlyMax: 10_000,
        benefitPeriod: { mode: "lifetime" },
      },
    });
    const { container } = render(<DisabilityCoverageTimeline coverage={cov(lifetime)} />);
    const bar = barOf(container);
    const longTerm = bar.querySelector(".bg-data-teal") as HTMLElement;
    const left = parseFloat(longTerm.style.left);
    const width = parseFloat(longTerm.style.width);
    expect(width).toBeGreaterThan(0);
    // 100.001 absorbs float noise (the true sum lands on 99.99999999999999)
    // while still catching the width-only clamp's 102.46%.
    expect(left + width).toBeLessThanOrEqual(100.001);
    expect(bar.textContent).toContain("…");
    expect(screen.getByText("months 3–336")).toBeInTheDocument();

    // The cap sits on its own opaque chip, not on the band. `text-ink-3` over
    // `bg-data-teal` is 1.03:1 in light theme and 1.91:1 in dark — under even
    // the 3:1 non-text floor — so the one mark that tells a sighted advisor the
    // bar is truncated was invisible on exactly the long benefit periods that
    // trigger it. `text-ink-2` on `bg-card-2` is 7.61:1 / 11.67:1.
    //
    // Contrast is the ratio of two KNOWN tokens, so it is decidable here; a
    // browser pass is for what jsdom cannot see. jsdom resolves no Tailwind, so
    // the class names are the honest handle, as with the lane test above.
    const cap = Array.from(bar.querySelectorAll("span")).find(
      (s) => s.textContent === "…",
    ) as HTMLElement;
    expect(cap.className).toContain("bg-card-2");
    expect(cap.className).toContain("text-ink-2");
    expect(cap.className).not.toContain("text-ink-3");
    // Still hidden from screen readers: the legend above carries the true end.
    expect(cap).toHaveAttribute("aria-hidden", "true");
  });
});
