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
}));

import { runProjection } from "@/engine/projection";
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
    stateEstateTaxRate: 0,
    stateEstateTax: 0,
    totalEstateTax: 0,
    totalTaxesAndExpenses: 0,
    dsueGenerated: 0,
    estateTaxDebits: [],
    creditorPayoffDebits: [],
    creditorPayoffResidual: 0,
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

beforeEach(() => {
  vi.mocked(runProjection).mockReset();
  // Mock fetch to return any JSON — content is irrelevant since runProjection
  // is mocked to return fixtures regardless.
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
    vi.mocked(runProjection).mockReturnValue([makeProjectionYear(hypo)]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={true}
        ownerNames={OWNERS}
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
    vi.mocked(runProjection).mockReturnValue([makeProjectionYear(hypo)]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={true}
        ownerNames={OWNERS}
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
    vi.mocked(runProjection).mockReturnValue([makeProjectionYear(hypo)]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={false}
        ownerNames={{ clientName: "Tom", spouseName: null }}
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
    vi.mocked(runProjection).mockReturnValue([
      makeProjectionYear(hypo2040),
      makeProjectionYear(hypo2050),
    ]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={true}
        ownerNames={OWNERS}
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
    vi.mocked(runProjection).mockReturnValue([makeProjectionYear(hypo)]);

    render(
      <EstateTaxReportView
        clientId="client-1"
        isMarried={true}
        ownerNames={OWNERS}
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
