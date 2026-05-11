// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

// Mock the projection engine so the component receives pre-built fixtures
// regardless of what the fetched input looks like. This bypasses the
// fetch-input → runProjection(data) flow: we mock `fetch` to return any
// JSON shape, and we mock `runProjection` to return our canned
// ProjectionYear[] fixture.
vi.mock("@/engine/projection", () => ({
  runProjection: vi.fn(),
  runProjectionWithEvents: vi.fn(),
}));

import { runProjection, runProjectionWithEvents } from "@/engine/projection";
import EstateTaxReportView from "@/components/estate-tax-report-view";
import type {
  EstateTaxResult,
  GrossEstateLine,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  ProjectionYear,
} from "@/engine/types";

// ── Fixture builders ────────────────────────────────────────────────────────

function makeEstateTaxResult(
  overrides: Partial<EstateTaxResult> = {},
): EstateTaxResult {
  const grossEstateLines: GrossEstateLine[] = overrides.grossEstateLines ?? [
    {
      label: "Brokerage",
      accountId: "acct-1",
      liabilityId: null,
      percentage: 1,
      amount: 0,
    },
  ];
  return {
    year: 2040,
    deathOrder: 1,
    deceased: "client",
    grossEstateLines,
    grossEstate: 0,
    estateAdminExpenses: 0,
    maritalDeduction: 0,
    charitableDeduction: 0,
    taxableEstate: 0,
    adjustedTaxableGifts: 0,
    lifetimeGiftTaxAdjustment: 0,
    tentativeTaxBase: 0,
    tentativeTax: 0,
    beaAtDeathYear: 0,
    dsueReceived: 0,
    applicableExclusion: 0,
    unifiedCredit: 0,
    federalEstateTax: 0,
    residenceState: null,
    stateEstateTaxRate: 0,
    stateEstateTax: 0,
    stateEstateTaxDetail: {
      state: null,
      fallbackUsed: false,
      fallbackRate: 0,
      exemption: 0,
      exemptionYear: 0,
      giftAddback: 0,
      baseForTax: 0,
      amountOverExemption: 0,
      bracketLines: [],
      preCapTax: 0,
      stateEstateTax: 0,
      notes: [],
    },
    totalEstateTax: 0,
    totalTaxesAndExpenses: 0,
    dsueGenerated: 0,
    estateTaxDebits: [],
    creditorPayoffDebits: [],
    creditorPayoffResidual: 0,
    drainAttributions: [],
    ...overrides,
  };
}

function makeOrdering(
  firstDecedent: "client" | "spouse",
  firstDeath: Partial<EstateTaxResult>,
  finalDeath: Partial<EstateTaxResult> | null,
  totals?: Partial<HypotheticalEstateTaxOrdering["totals"]>,
): HypotheticalEstateTaxOrdering {
  const first = makeEstateTaxResult({
    deathOrder: 1,
    deceased: firstDecedent,
    ...firstDeath,
  });
  const final = finalDeath
    ? makeEstateTaxResult({
        deathOrder: 2,
        deceased: firstDecedent === "client" ? "spouse" : "client",
        ...finalDeath,
      })
    : undefined;
  const computed = {
    federal: first.federalEstateTax + (final?.federalEstateTax ?? 0),
    state: first.stateEstateTax + (final?.stateEstateTax ?? 0),
    admin: first.estateAdminExpenses + (final?.estateAdminExpenses ?? 0),
    total: first.totalTaxesAndExpenses + (final?.totalTaxesAndExpenses ?? 0),
  };
  return {
    firstDecedent,
    firstDeath: first,
    finalDeath: final,
    firstDeathTransfers: [],
    finalDeathTransfers: final ? [] : undefined,
    totals: { ...computed, ...totals },
  };
}

function makeHypothetical(
  year: number,
  married: boolean,
  opts: {
    primary: {
      first: Partial<EstateTaxResult>;
      final: Partial<EstateTaxResult> | null;
      totals?: Partial<HypotheticalEstateTaxOrdering["totals"]>;
    };
    spouse?: {
      first: Partial<EstateTaxResult>;
      final: Partial<EstateTaxResult> | null;
      totals?: Partial<HypotheticalEstateTaxOrdering["totals"]>;
    };
  },
): HypotheticalEstateTax {
  const primaryFirst = makeOrdering(
    "client",
    { ...opts.primary.first, year },
    opts.primary.final ? { ...opts.primary.final, year } : null,
    opts.primary.totals,
  );
  const spouseFirst =
    married && opts.spouse
      ? makeOrdering(
          "spouse",
          { ...opts.spouse.first, year },
          opts.spouse.final ? { ...opts.spouse.final, year } : null,
          opts.spouse.totals,
        )
      : undefined;
  return { year, primaryFirst, spouseFirst };
}

function makeProjectionYear(hypothetical: HypotheticalEstateTax): ProjectionYear {
  // Most fields of ProjectionYear are not read by EstateTaxReportView.
  // Cast through unknown so we don't have to stub the entire output type.
  return {
    year: hypothetical.year,
    hypotheticalEstateTax: hypothetical,
  } as unknown as ProjectionYear;
}

// ── Test setup ─────────────────────────────────────────────────────────────

const OWNERS = { clientName: "Tom", spouseName: "Linda" };
const DOBS = { clientDob: "1960-01-01", spouseDob: "1962-01-01" };
const SINGLE_DOBS = { clientDob: "1960-01-01", spouseDob: null };
const RETIREMENT_YEAR = 2027;

/** Wraps a mocked runProjection return into the runProjectionWithEvents shape. */
function setProjectionFixture(years: ProjectionYear[]) {
  vi.mocked(runProjection).mockReturnValue(years);
  const firstIdx = years.findIndex((y) => y.estateTax?.deathOrder === 1);
  const secondIdx = years.findIndex((y) => y.estateTax?.deathOrder === 2);
  // Reuse the first year's hypothetical as the BoY-of-planStart fixture; the
  // tests in this file don't exercise the Today view distinctly from the
  // first-year EoY snapshot, so a shared object keeps the fixture minimal.
  const firstYear = years[0];
  const todayHypo: HypotheticalEstateTax =
    firstYear?.hypotheticalEstateTax ??
    ({
      year: firstYear?.year ?? 0,
      primaryFirst: {} as HypotheticalEstateTaxOrdering,
    } as HypotheticalEstateTax);
  vi.mocked(runProjectionWithEvents).mockReturnValue({
    years,
    firstDeathEvent: firstIdx >= 0 ? years[firstIdx].estateTax : undefined,
    secondDeathEvent: secondIdx >= 0 ? years[secondIdx].estateTax : undefined,
    todayHypotheticalEstateTax: todayHypo,
    giftLedger: [],
  });
}

beforeEach(() => {
  vi.mocked(runProjection).mockReset();
  vi.mocked(runProjectionWithEvents).mockReset();
  // Mock fetch to return any JSON — content is irrelevant since the engine is
  // mocked to return fixtures regardless.
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  })) as unknown as typeof fetch;
});

describe("EstateTaxReportView", () => {
  it("renders both decedent sections and grand totals for a zero-tax married fixture", async () => {
    const hypo = makeHypothetical(2040, true, {
      primary: { first: {}, final: {} },
      spouse: { first: {}, final: {} },
    });
    setProjectionFixture([makeProjectionYear(hypo)]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={true}
        ownerNames={OWNERS}
        ownerDobs={DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Tom — First to die/)).toBeDefined(),
    );
    expect(screen.getByText(/Linda — Second to die/)).toBeDefined();
    expect(screen.getByText(/Grand totals/i)).toBeDefined();
  });

  it("sums federal + state in grand totals for a high-tax married fixture", async () => {
    const hypo = makeHypothetical(2045, true, {
      primary: {
        first: { federalEstateTax: 500_000, stateEstateTax: 0 },
        final: {
          federalEstateTax: 2_000_000,
          stateEstateTax: 500_000,
          totalEstateTax: 2_500_000,
          totalTaxesAndExpenses: 2_500_000,
          estateAdminExpenses: 0,
        },
        totals: {
          federal: 2_500_000,
          state: 500_000,
          admin: 0,
          total: 3_000_000,
        },
      },
      spouse: { first: {}, final: {} },
    });
    setProjectionFixture([makeProjectionYear(hypo)]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={true}
        ownerNames={OWNERS}
        ownerDobs={DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Grand totals/i)).toBeDefined(),
    );
    // Grand-total federal row shows the summed $2,500,000 (scoped to Grand totals section).
    const grandTotals = screen.getByText(/Grand totals/i).closest("section")!;
    expect(within(grandTotals).getByText("$2,500,000")).toBeDefined();
    // The grand-total row shows $3,000,000 as the overall total.
    expect(within(grandTotals).getByText("$3,000,000")).toBeDefined();
  });

  it("hides grand totals and ordering toggle for single filer, and shows the single-filer heading", async () => {
    const hypo: HypotheticalEstateTax = {
      year: 2050,
      primaryFirst: makeOrdering("client", { year: 2050 }, null),
      // No spouseFirst, no finalDeath.
    };
    setProjectionFixture([makeProjectionYear(hypo)]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={false}
        ownerNames={{ clientName: "Tom", spouseName: null }}
        ownerDobs={SINGLE_DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Tom — Hypothetical death in 2050/),
      ).toBeDefined(),
    );
    // Ordering toggle buttons are not rendered for single filers.
    expect(screen.queryByRole("button", { name: /dies first/i })).toBeNull();
    // Grand totals hidden per Task 9 fix.
    expect(screen.queryByText(/Grand totals/i)).toBeNull();
    // And there's no second-decedent section.
    expect(screen.queryByText(/Second to die/i)).toBeNull();
  });

  it("updates the displayed amounts when the year dropdown is changed", async () => {
    const hypo2040 = makeHypothetical(2040, true, {
      primary: {
        first: { federalEstateTax: 111_000 },
        final: {},
        totals: { federal: 111_000, state: 0, admin: 0, total: 111_000 },
      },
      spouse: { first: {}, final: {} },
    });
    const hypo2050 = makeHypothetical(2050, true, {
      primary: {
        first: { federalEstateTax: 999_000 },
        final: {},
        totals: { federal: 999_000, state: 0, admin: 0, total: 999_000 },
      },
      spouse: { first: {}, final: {} },
    });
    setProjectionFixture([
      makeProjectionYear(hypo2040),
      makeProjectionYear(hypo2050),
    ]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={true}
        ownerNames={OWNERS}
        ownerDobs={DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText("$111,000").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("$999,000")).toBeNull();

    // Change year to 2050.
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "2050" } });

    await waitFor(() =>
      expect(screen.getAllByText("$999,000").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("$111,000")).toBeNull();
  });

  it("swaps the first-decedent heading when the ordering toggle is clicked", async () => {
    // primaryFirst: Tom dies first (distinct federal number for Tom's death)
    // spouseFirst: Linda dies first (distinct federal number for Linda's death)
    const hypo: HypotheticalEstateTax = {
      year: 2040,
      primaryFirst: makeOrdering(
        "client",
        { year: 2040, federalEstateTax: 123_000 },
        { year: 2040 },
        { federal: 123_000, state: 0, admin: 0, total: 123_000 },
      ),
      spouseFirst: makeOrdering(
        "spouse",
        { year: 2040, federalEstateTax: 456_000 },
        { year: 2040 },
        { federal: 456_000, state: 0, admin: 0, total: 456_000 },
      ),
    };
    setProjectionFixture([makeProjectionYear(hypo)]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={true}
        ownerNames={OWNERS}
        ownerDobs={DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Tom — First to die/)).toBeDefined(),
    );
    expect(screen.queryByText(/^Linda — First to die$/)).toBeNull();

    // Click "Linda dies first".
    fireEvent.click(screen.getByRole("button", { name: /Linda dies first/i }));

    await waitFor(() =>
      expect(screen.getByText(/Linda — First to die/)).toBeDefined(),
    );
    expect(screen.getByText(/Tom — Second to die/)).toBeDefined();
    // Assert that dollar values swap: $456,000 (Linda's) now appears, $123,000 (Tom's) is hidden.
    await waitFor(() => expect(screen.getAllByText("$456,000").length).toBeGreaterThan(0));
    expect(screen.queryByText("$123,000")).toBeNull();
  });
});

// ── State estate tax breakdown — special-rule states ────────────────────────

describe("EstateTaxReportView — state estate tax breakdown", () => {
  it("MA anti-cliff: renders bracket lines + anti-cliff note", async () => {
    const hypo = makeHypothetical(2040, false, {
      primary: {
        first: null as unknown as Partial<EstateTaxResult>,
        final: {
          residenceState: "MA",
          stateEstateTax: 179_040,
          stateEstateTaxDetail: {
            state: "MA",
            fallbackUsed: false,
            fallbackRate: 0,
            exemption: 2_000_000,
            exemptionYear: 2023,
            baseForTax: 4_250_000,
            amountOverExemption: 2_250_000,
            giftAddback: 0,
            bracketLines: [
              { from: 2_000_000, to: 3_040_000, rate: 0.072, amountTaxed: 1_040_000, tax: 74_880 },
              { from: 3_040_000, to: 3_540_000, rate: 0.080, amountTaxed: 500_000, tax: 40_000 },
              { from: 3_540_000, to: 4_040_000, rate: 0.088, amountTaxed: 500_000, tax: 44_000 },
              { from: 4_040_000, to: 5_040_000, rate: 0.096, amountTaxed: 210_000, tax: 20_160 },
            ],
            preCapTax: 179_040,
            stateEstateTax: 179_040,
            antiCliffCreditApplied: true,
            notes: [
              "Citation: MGL c.65C as amended Oct 2023 (anti-cliff exclusion; tax on excess above $2M).",
              "MA anti-cliff exclusion applied: first $2,000,000 not taxed.",
            ],
          },
        },
      },
    });
    // first-only single-decedent fixture: use the primary.final as the only death
    const primaryFirst = makeOrdering("client", hypo.primaryFirst.firstDeath, null);
    primaryFirst.finalDeath = undefined;
    const finalAsFirst = makeOrdering("client", {
      ...hypo.primaryFirst.firstDeath,
      deathOrder: 1,
    }, null);
    finalAsFirst.firstDeath = makeEstateTaxResult({
      year: 2040,
      deathOrder: 1,
      deceased: "client",
      residenceState: "MA",
      stateEstateTax: 179_040,
      stateEstateTaxDetail: {
        state: "MA",
        fallbackUsed: false,
        fallbackRate: 0,
        exemption: 2_000_000,
        exemptionYear: 2023,
        baseForTax: 4_250_000,
        amountOverExemption: 2_250_000,
        giftAddback: 0,
        bracketLines: [
          { from: 2_000_000, to: 3_040_000, rate: 0.072, amountTaxed: 1_040_000, tax: 74_880 },
          { from: 3_040_000, to: 3_540_000, rate: 0.080, amountTaxed: 500_000, tax: 40_000 },
          { from: 3_540_000, to: 4_040_000, rate: 0.088, amountTaxed: 500_000, tax: 44_000 },
          { from: 4_040_000, to: 5_040_000, rate: 0.096, amountTaxed: 210_000, tax: 20_160 },
        ],
        preCapTax: 179_040,
        stateEstateTax: 179_040,
        antiCliffCreditApplied: true,
        notes: [
          "Citation: MGL c.65C as amended Oct 2023.",
          "MA anti-cliff exclusion applied: first $2,000,000 not taxed.",
        ],
      },
    });
    const fixture: HypotheticalEstateTax = {
      year: 2040,
      primaryFirst: finalAsFirst,
    };
    setProjectionFixture([makeProjectionYear(fixture)]);
    render(
      <EstateTaxReportView
        clientId="c1"
        isMarried={false}
        ownerNames={OWNERS}
        ownerDobs={SINGLE_DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() => expect(screen.getByText(/State Estate Tax \(Massachusetts\)/)).toBeDefined());
    expect(screen.getByText(/MA anti-cliff exclusion applied/)).toBeDefined();
    // Bracket line: from $2.00M – $3.04M × 7.20%
    expect(screen.getByText(/\$2\.00M.*\$3\.04M.*7\.20%/)).toBeDefined();
    // Subtotal
    expect(screen.getAllByText("$179,040").length).toBeGreaterThan(0);
  });

  it("CT cap: renders combined-cap deduction note", async () => {
    const hypo = makeHypothetical(2040, false, {
      primary: { first: {}, final: null },
    });
    const detail = {
      state: "CT" as const,
      fallbackUsed: false,
      fallbackRate: 0,
      exemption: 15_000_000,
      exemptionYear: 2026,
      baseForTax: 200_000_000,
      amountOverExemption: 185_000_000,
      giftAddback: 0,
      bracketLines: [
        { from: 15_000_000, to: 200_000_000, rate: 0.12, amountTaxed: 185_000_000, tax: 22_200_000 },
      ],
      preCapTax: 22_200_000,
      cap: { applied: true, cap: 15_000_000, reduction: 7_200_000 },
      stateEstateTax: 15_000_000,
      notes: [
        "Citation: CT Gen. Stat. §12-391.",
        "Max combined estate+gift tax cap of $15,000,000 applied; pre-cap tax was $22,200,000.",
      ],
    };
    hypo.primaryFirst.firstDeath = makeEstateTaxResult({
      year: 2040,
      deathOrder: 1,
      deceased: "client",
      residenceState: "CT",
      stateEstateTax: 15_000_000,
      stateEstateTaxDetail: detail,
    });
    setProjectionFixture([makeProjectionYear(hypo)]);
    render(
      <EstateTaxReportView
        clientId="c1"
        isMarried={false}
        ownerNames={OWNERS}
        ownerDobs={SINGLE_DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() => expect(screen.getByText(/State Estate Tax \(Connecticut\)/)).toBeDefined());
    expect(screen.getByText(/Max combined cap/)).toBeDefined();
    expect(screen.getAllByText("$15,000,000").length).toBeGreaterThan(0);
  });

  it("NY cliff applied: shows full-estate base + cliff note", async () => {
    const hypo = makeHypothetical(2040, false, {
      primary: { first: {}, final: null },
    });
    hypo.primaryFirst.firstDeath = makeEstateTaxResult({
      year: 2040,
      deathOrder: 1,
      deceased: "client",
      residenceState: "NY",
      stateEstateTax: 773_200,
      stateEstateTaxDetail: {
        state: "NY",
        fallbackUsed: false,
        fallbackRate: 0,
        exemption: 7_160_000,
        exemptionYear: 2025,
        baseForTax: 8_000_000,
        amountOverExemption: 8_000_000,
        giftAddback: 0,
        bracketLines: [
          { from: 0, to: 500_000, rate: 0.0306, amountTaxed: 500_000, tax: 15_300 },
        ],
        preCapTax: 773_200,
        cliff: { applied: true, threshold: 7_518_000 },
        stateEstateTax: 773_200,
        notes: [
          "Citation: NY Tax Law §952.",
          "NY 105% cliff applied: taxable estate exceeds 105% of exemption ($7,518,000). Entire estate is taxable.",
        ],
      },
    });
    setProjectionFixture([makeProjectionYear(hypo)]);
    render(
      <EstateTaxReportView
        clientId="c1"
        isMarried={false}
        ownerNames={OWNERS}
        ownerDobs={SINGLE_DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() => expect(screen.getByText(/State Estate Tax \(New York\)/)).toBeDefined());
    expect(screen.getByText(/NY 105% cliff applied/)).toBeDefined();
    expect(screen.getAllByText("$773,200").length).toBeGreaterThan(0);
  });

  it("Custom override (fallback) renders legacy two-line layout", async () => {
    const hypo = makeHypothetical(2040, false, {
      primary: { first: {}, final: null },
    });
    hypo.primaryFirst.firstDeath = makeEstateTaxResult({
      year: 2040,
      deathOrder: 1,
      deceased: "client",
      residenceState: null,
      taxableEstate: 1_000_000,
      stateEstateTax: 80_000,
      stateEstateTaxRate: 0.08,
      stateEstateTaxDetail: {
        state: null,
        fallbackUsed: true,
        fallbackRate: 0.08,
        exemption: 0,
        exemptionYear: 0,
        giftAddback: 0,
        baseForTax: 1_000_000,
        amountOverExemption: 0,
        bracketLines: [],
        preCapTax: 80_000,
        stateEstateTax: 80_000,
        notes: ["Custom flat rate of 8.00% applied."],
      },
    });
    setProjectionFixture([makeProjectionYear(hypo)]);
    render(
      <EstateTaxReportView
        clientId="c1"
        isMarried={false}
        ownerNames={OWNERS}
        ownerDobs={SINGLE_DOBS}
        retirementYear={RETIREMENT_YEAR}
      />,
    );

    await waitFor(() => expect(screen.getByText(/State Estate Tax \(Custom Override\)/)).toBeDefined());
    expect(screen.getByText(/Taxable Estate × 8\.00%/)).toBeDefined();
  });
});
