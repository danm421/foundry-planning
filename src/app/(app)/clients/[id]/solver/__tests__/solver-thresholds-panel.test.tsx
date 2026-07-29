// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resolveStatusLabel, SolverThresholdsPanel } from "../solver-thresholds-panel";
import {
  THRESHOLD_ITEMS,
  rangeFor,
  isNaRange,
  type ThresholdFacts,
  type ThresholdHousehold,
} from "@/lib/tax/thresholds";
import type { TaxYearParameters } from "@/lib/tax/types";
import type { ClientData, ProjectionYear } from "@/engine/types";

// Only the params RESOLVER is stubbed. `buildThresholdReport`, `statusFor` and
// `resolveStatusLabel` all stay REAL, so the rendered statuses are genuinely
// computed from the facts below rather than handed to the panel — which is the
// whole point of rendering. Resolution itself is covered by
// src/lib/solver/__tests__/threshold-params.test.ts.
const mocks = vi.hoisted(() => ({ resolveThresholdParams: vi.fn() }));
vi.mock("@/lib/solver/threshold-params", () => ({
  resolveThresholdParams: mocks.resolveThresholdParams,
}));

// Same fixture shape as src/lib/reports/__tests__/threshold-report-data.test.ts
// — fully seeded so every item resolves a REAL range (not the NA sentinel)
// wherever one exists structurally, letting the guard test below tell
// "genuinely a point threshold" apart from "NA because unseeded/inapplicable".
const params = {
  rothPhaseout: { startMfj: 242000, endMfj: 252000, startSingle: 153000, endSingle: 168000 },
  iraDeduct: {
    coveredStartMfj: 129000, coveredEndMfj: 149000,
    coveredStartSingle: 81000, coveredEndSingle: 91000,
    spousalStartMfj: 242000, spousalEndMfj: 252000,
  },
  studentLoan: { maxDeduction: 2500, startMfj: 175000, endMfj: 205000, startSingle: 85000, endSingle: 100000 },
  ctc: { perChild: 2200, refundableMax: 1700, odcPerDependent: 500 },
  saversCredit: { mfj: [{ rate: 0.5, agiCeiling: 48500 }, { rate: 0.2, agiCeiling: 52500 }, { rate: 0.1, agiCeiling: 80500 }], single: [], hoh: [] },
  qbi: { thresholdMfj: 403550, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
  amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
  amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
} as unknown as TaxYearParameters;

// MFJ with >=1 qualifying child so `ctc`'s rangeFor doesn't fall into
// NA_RANGE for a household-driven reason (gross <= 0) — rangeFor's own NA
// branches for every OTHER item are structural (filing status / unseeded
// params), not household-driven, so this one household is enough to surface
// every item's real shape.
const household: ThresholdHousehold = {
  filingStatus: "married_joint",
  qualifyingChildren: 1, otherDependents: 0, aotcStudents: 1,
  hasStudentLoanInterest: true, hasRothContribution: true,
  hasTraditionalIraContribution: true, hasQbi: true, hasInvestmentIncome: true,
  hasRetirementContributions: true,
  coveredSelf: true, coveredSpouse: false,
};

describe("[F1] point-threshold label overrides", () => {
  it("every genuine point-threshold item (end == null, excluding charitableLimit) has a deliberate label override", () => {
    const year = 2026;
    const checked: string[] = [];
    for (const item of THRESHOLD_ITEMS) {
      if (item.id === "charitableLimit") continue; // statusFor() always resolves "full"; never reaches a label override
      const range = rangeFor(item.id, year, params, household.filingStatus, household);
      if (isNaRange(range) || range.end !== null) continue; // not a point threshold for this fixture
      checked.push(item.id);
      // A deliberate override means the label actually differs from the
      // generic default that reads backwards for a burden — merely equaling
      // the default (by omission) would defeat the guard.
      expect(resolveStatusLabel(item.id, "out")).not.toBe("Phased Out");
      expect(resolveStatusLabel(item.id, "full")).not.toBe("Full");
    }
    // Sanity: this fixture must actually exercise at least one point
    // threshold, or the loop above is vacuously true.
    expect(checked).toContain("niit");
  });

  it("niit renders the correct label in both directions", () => {
    // Below the threshold: NIIT does not apply.
    expect(resolveStatusLabel("niit", "full")).toBe("Does Not Apply");
    // At/above the threshold: NIIT applies.
    expect(resolveStatusLabel("niit", "out")).toBe("Applies");
  });

  it("non-point-threshold items keep the generic labels", () => {
    // amtExemption and qbi are genuine phase-outs of a benefit — "Phased
    // Out" is correct for them, and they must NOT have been swept into the
    // override map by an over-broad fix.
    expect(resolveStatusLabel("amtExemption", "out")).toBe("Phased Out");
    expect(resolveStatusLabel("qbi", "full")).toBe("Full");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The panel itself. Everything above this line tests one exported pure helper;
// until these were added the COMPONENT was never rendered, so the two status
// columns could be swapped and all 771 tests in this area still passed.
// ════════════════════════════════════════════════════════════════════════════

type Facts = Omit<ThresholdFacts, "params">;

const facts = (over: Partial<Facts> = {}): Facts => ({
  year: 2026, household,
  agi: 300000, magiForIraDeduction: 300000, magiForStudentLoan: 300000,
  magiForRoth: 300000, magiForCredits: 300000,
  taxableIncomeBeforeQbi: 300000, amti: 300000,
  ...over,
});

const py = (year: number, thresholdFacts?: Facts): ProjectionYear =>
  ({ year, thresholdFacts } as ProjectionYear);

/** The panel reads nothing off the tree itself — it only forwards it to the
 *  (stubbed) resolver — so an empty object is honest here rather than a
 *  hand-built plan that would imply the panel inspects it. */
const TREE = {} as ClientData;

/** The four cells of one item's row, IN ORDER: label, range, Alternative,
 *  Original. Reading them positionally is the point — a `getByText("Applies")`
 *  would pass just as happily with the two status columns swapped. */
function rowCells(label: string): (string | undefined)[] {
  const cell = screen.getByRole("cell", { name: label });
  const row = cell.closest("tr")!;
  return within(row).getAllByRole("cell").map((c) => c.textContent?.trim());
}

/** ALTERNATIVE is over every threshold, ORIGINAL is under every one. The two
 *  sides must DIFFER on the rows asserted below or a column swap is the
 *  identity transform and these tests cannot see it. */
const OVER = facts();                                    // AGI/MAGI 300,000
const UNDER = facts({
  agi: 200000, magiForIraDeduction: 200000, magiForStudentLoan: 200000,
  magiForRoth: 200000, magiForCredits: 200000,
  taxableIncomeBeforeQbi: 200000, amti: 200000,
});

describe("SolverThresholdsPanel", () => {
  beforeEach(() => {
    mocks.resolveThresholdParams.mockReset();
    mocks.resolveThresholdParams.mockReturnValue(params);
  });

  const renderPanel = (
    years: ProjectionYear[] = [py(2026, OVER)],
    baseProjection: ProjectionYear[] = [py(2026, UNDER)],
  ) => render(
    <SolverThresholdsPanel years={years} baseProjection={baseProjection} workingTree={TREE} />,
  );

  it("puts the Alternative status in the third column and the Original in the fourth", () => {
    renderPanel();
    // NIIT is the row where a swap is loudest: it is the one item whose labels
    // are OVERRIDDEN, so the two sides read as opposite sentences rather than
    // as two points on a phase-out ramp.
    expect(rowCells("Net Investment Income Tax")).toEqual([
      "Net Investment Income Tax", "$250,000", "Applies", "Does Not Apply",
    ]);
    // A second row, with the GENERIC labels and a two-ended range, so the
    // column mapping is pinned for the ordinary case too and not just for the
    // one item carrying an override.
    expect(rowCells("Roth IRA Contribution")).toEqual([
      "Roth IRA Contribution", "$242,000 - $252,000", "Phased Out", "Full",
    ]);
  });

  it("labels the columns in the order the cells are written", () => {
    renderPanel();
    // Pins the OTHER half of the mapping: swapping the two <th>s would leave
    // the assertion above green while every advisor read the table backwards.
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent?.trim()))
      .toEqual(["Threshold", "Range", "Alternative", "Original"]);
  });

  it("[C3] gives the charitable row a DIFFERENT dollar ceiling per side, with the rule in the Range cell", () => {
    renderPanel();
    // The two sides' AGIs differ (300,000 vs 200,000), so the two ceilings
    // differ too — which is what makes swapping the Alternative/Original <td>
    // bodies visible here. Hand-computed: 0.6 * 300,000 and 0.6 * 200,000.
    //
    // These two cells hold FIGURES, not a StatusCell: statusFor() returns
    // "full" unconditionally for this row, so "Full"/"Full" carried no signal
    // and the per-side ceilings are the only useful thing to put there.
    expect(rowCells("Qualified Charitable Contribution Limit")).toEqual([
      "Qualified Charitable Contribution Limit", "60% of AGI", "$180,000", "$120,000",
    ]);
  });

  it("renders all 11 items, in THRESHOLD_ITEMS order", () => {
    renderPanel();
    const labels = screen.getAllByRole("row").slice(1)  // drop the header row
      .map((r) => within(r).getAllByRole("cell")[0].textContent?.trim());
    expect(labels).toEqual(THRESHOLD_ITEMS.map((i) => i.label));
  });

  it("switches the rows to the year picked in the selector", async () => {
    const user = userEvent.setup();
    // 2026 over the NIIT threshold, 2027 under it — so the selector CHANGING
    // the table is observable, rather than both years rendering alike.
    renderPanel(
      [py(2026, OVER), py(2027, facts({ year: 2027, agi: 100000 }))],
      [py(2026, UNDER), py(2027, facts({ year: 2027, agi: 100000 }))],
    );
    expect(rowCells("Net Investment Income Tax")[2]).toBe("Applies");

    await user.selectOptions(screen.getByLabelText("Year"), "2027");
    expect(rowCells("Net Investment Income Tax")[2]).toBe("Does Not Apply");
  });

  it("explains the bracket-mode requirement instead of rendering an empty table", () => {
    // A live production path, not a defensive branch: `thresholdFacts` is
    // populated in bracket mode only (see threshold-report-data.ts).
    renderPanel([py(2026, undefined)], [py(2026, UNDER)]);
    expect(screen.getByText(/requires bracket tax mode/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("falls back to the same message when the year resolves no tax params", () => {
    mocks.resolveThresholdParams.mockReturnValue(null);
    renderPanel();
    expect(screen.getByText(/requires bracket tax mode/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the empty state with no projection years", () => {
    renderPanel([], []);
    expect(screen.getByText("No projection years to show.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("marks every Original cell N/A when there is no base plan for the year", () => {
    renderPanel([py(2026, OVER)], []);
    // "na" has no per-item override, so even NIIT falls back to the generic
    // "N/A" here — it does NOT read "Does Not Apply", which would assert a
    // fact about the household rather than the absence of a comparison.
    expect(rowCells("Net Investment Income Tax")).toEqual([
      "Net Investment Income Tax", "$250,000", "Applies", "N/A",
    ]);
    // The Alternative column must NOT be blanked along with the Original.
    expect(rowCells("Roth IRA Contribution")).toEqual([
      "Roth IRA Contribution", "$242,000 - $252,000", "Phased Out", "N/A",
    ]);
  });

  it("[C3] em-dashes the charitable row's Original ceiling with no base plan, keeping the Alternative's", () => {
    renderPanel([py(2026, OVER)], []);
    // "—", not "N/A": this cell holds a ceiling, and the reason there isn't
    // one is that there is no Original AGI to take 60% of. It must also not
    // fall back to the StatusCell, which would print an unconditional "Full"
    // beside a real dollar figure on the other side.
    expect(rowCells("Qualified Charitable Contribution Limit")).toEqual([
      "Qualified Charitable Contribution Limit", "60% of AGI", "$180,000", "—",
    ]);
  });
});
