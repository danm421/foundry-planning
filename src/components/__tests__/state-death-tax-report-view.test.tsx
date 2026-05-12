// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: (data: unknown) => (data as { __result: unknown }).__result,
}));

import StateDeathTaxReportView from "../state-death-tax-report-view";
import type { EstateTaxResult } from "@/engine/types";
import type { StateEstateTaxResult } from "@/lib/tax/state-estate/types";
import type { StateInheritanceTaxResult } from "@/lib/tax/state-inheritance/types";

const baseEstate: Partial<EstateTaxResult> = {
  year: 2050,
  deathOrder: 1,
  deceased: "client",
  grossEstateLines: [],
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
  residenceState: "PA",
  stateEstateTaxRate: 0,
  stateEstateTax: 0,
  totalEstateTax: 0,
  totalTaxesAndExpenses: 0,
};

// PA doesn't levy a state estate tax — real engine output sets state to null
// for residents of states not in STATE_ESTATE_TAX.
const paEstateDetail: StateEstateTaxResult = {
  state: null,
  fallbackUsed: false, fallbackRate: 0,
  exemption: 0, exemptionYear: 2026, giftAddback: 0,
  baseForTax: 0, amountOverExemption: 0, bracketLines: [],
  preCapTax: 0, stateEstateTax: 0, notes: [],
};

const paInheritance: StateInheritanceTaxResult = {
  state: "PA",
  inactive: false,
  estateMinimumFloorApplied: false,
  totalTax: 24_000,
  notes: ["Citation: 72 Pa. Cons. Stat. §9116"],
  perRecipient: [{
    recipientKey: "sib", label: "Sibling Smith", classLabel: "C",
    classSource: "derived-from-relationship",
    grossShare: 200_000, excluded: 0, excludedReasons: [],
    exemption: 0, taxableShare: 200_000,
    bracketLines: [{ from: 0, to: 200_000, rate: 0.12, amountTaxed: 200_000, tax: 24_000 }],
    tax: 24_000, netToRecipient: 176_000, notes: [],
  }],
};

function mockProjection(overrides: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ __result: overrides }),
  }) as unknown as typeof fetch;
}

const ownerProps = {
  isMarried: false,
  ownerNames: { clientName: "Alex", spouseName: null },
  ownerDobs: { clientDob: "1970-01-01", spouseDob: null },
  retirementYear: 2035,
};

describe("StateDeathTaxReportView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the Today hypothetical PA recipient table", async () => {
    const decedent: EstateTaxResult = {
      ...(baseEstate as EstateTaxResult),
      stateEstateTaxDetail: paEstateDetail,
      stateInheritanceTax: paInheritance,
    };
    mockProjection({
      firstDeathEvent: decedent,
      secondDeathEvent: undefined,
      years: [{ year: 2026, hypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 0, admin: 0, total: 0 } } } }],
      todayHypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 0, admin: 0, total: 0 } } },
    });

    render(<StateDeathTaxReportView clientId="c1" {...ownerProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Sibling Smith/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Class C/)).toBeInTheDocument();
    expect(screen.getAllByText(/\$24,000/).length).toBeGreaterThan(0);
  });

  const nyEstateDetail: import("@/lib/tax/state-estate").StateEstateTaxResult = {
    state: "NY",
    fallbackUsed: false, fallbackRate: 0,
    exemption: 7_160_000, exemptionYear: 2026, giftAddback: 0,
    baseForTax: 10_000_000, amountOverExemption: 2_840_000,
    bracketLines: [
      { from: 7_160_000, to: 10_100_000, rate: 0.1, amountTaxed: 2_840_000, tax: 284_000 },
    ],
    preCapTax: 284_000, stateEstateTax: 284_000,
    notes: ["Citation: NY Tax Law §952"],
  };

  it("renders the NY state-estate-tax bracket breakdown when no inheritance tax applies", async () => {
    const decedent: EstateTaxResult = {
      ...(baseEstate as EstateTaxResult),
      residenceState: "NY",
      stateEstateTax: 284_000,
      stateEstateTaxDetail: nyEstateDetail,
      stateInheritanceTax: undefined,
    };
    mockProjection({
      firstDeathEvent: decedent,
      secondDeathEvent: undefined,
      years: [{ year: 2026, hypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 284_000, admin: 0, total: 284_000 } } } }],
      todayHypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 284_000, admin: 0, total: 284_000 } } },
    });

    render(<StateDeathTaxReportView clientId="c1" {...ownerProps} />);

    await waitFor(() => {
      expect(screen.getByText(/State Estate Tax \(New York\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Amount Over Exemption/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$284,000/).length).toBeGreaterThan(0);
  });

  const mdEstateDetail: import("@/lib/tax/state-estate").StateEstateTaxResult = {
    state: "MD",
    fallbackUsed: false, fallbackRate: 0,
    exemption: 5_000_000, exemptionYear: 2026, giftAddback: 0,
    baseForTax: 6_000_000, amountOverExemption: 1_000_000,
    bracketLines: [{ from: 5_000_000, to: 6_000_000, rate: 0.16, amountTaxed: 1_000_000, tax: 160_000 }],
    preCapTax: 160_000, stateEstateTax: 130_000,
    notes: ["Citation: Md. Code, Tax-Gen. §7-309"],
    inheritanceCredit: { applied: true, credit: 30_000, reduction: 30_000 },
  };

  const mdInheritance: import("@/lib/tax/state-inheritance").StateInheritanceTaxResult = {
    state: "MD",
    inactive: false,
    estateMinimumFloorApplied: false,
    totalTax: 30_000,
    notes: ["Citation: Md. Code, Tax-Gen. §7-203"],
    perRecipient: [{
      recipientKey: "niece", label: "Niece Jones", classLabel: "C",
      classSource: "derived-from-relationship",
      grossShare: 300_000, excluded: 0, excludedReasons: [],
      exemption: 0, taxableShare: 300_000,
      bracketLines: [{ from: 0, to: 300_000, rate: 0.10, amountTaxed: 300_000, tax: 30_000 }],
      tax: 30_000, netToRecipient: 270_000, notes: [],
    }],
  };

  it("renders MD dual sections + combined total + credit callout", async () => {
    const decedent: EstateTaxResult = {
      ...(baseEstate as EstateTaxResult),
      residenceState: "MD",
      stateEstateTax: 130_000,
      stateEstateTaxDetail: mdEstateDetail,
      stateInheritanceTax: mdInheritance,
    };
    mockProjection({
      firstDeathEvent: decedent,
      secondDeathEvent: undefined,
      years: [{ year: 2026, hypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 130_000, admin: 0, total: 160_000 } } } }],
      todayHypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 130_000, admin: 0, total: 160_000 } } },
    });

    render(<StateDeathTaxReportView clientId="c1" {...ownerProps} />);

    await waitFor(() => {
      expect(screen.getByText(/State Estate Tax \(Maryland\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/State Inheritance Tax \(MD\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Niece Jones/)).toBeInTheDocument();
    // Combined total: 130,000 + 30,000 = 160,000
    expect(screen.getByText(/Total state death tax/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$160,000/).length).toBeGreaterThan(0);
    // Credit callout
    expect(screen.getByText(/inheritance.tax credit/i)).toBeInTheDocument();
  });

  it("does not show MD callout for non-MD inheritance state with custom estate-tax override", async () => {
    const njEstateDetail: import("@/lib/tax/state-estate").StateEstateTaxResult = {
      state: null,
      fallbackUsed: true, fallbackRate: 0.05,
      exemption: 0, exemptionYear: 0, giftAddback: 0,
      baseForTax: 1_000_000, amountOverExemption: 0,
      bracketLines: [],
      preCapTax: 50_000, stateEstateTax: 50_000,
      notes: ["Custom flat rate of 5% applied."],
    };
    const njInheritance: import("@/lib/tax/state-inheritance").StateInheritanceTaxResult = {
      state: "NJ",
      inactive: false,
      estateMinimumFloorApplied: false,
      totalTax: 20_000,
      notes: [],
      perRecipient: [{
        recipientKey: "sib", label: "Sibling Doe", classLabel: "D",
        classSource: "derived-from-relationship",
        grossShare: 100_000, excluded: 0, excludedReasons: [],
        exemption: 0, taxableShare: 100_000,
        bracketLines: [{ from: 0, to: 100_000, rate: 0.20, amountTaxed: 100_000, tax: 20_000 }],
        tax: 20_000, netToRecipient: 80_000, notes: [],
      }],
    };
    const decedent: EstateTaxResult = {
      ...(baseEstate as EstateTaxResult),
      residenceState: "NJ",
      stateEstateTax: 50_000,
      stateEstateTaxDetail: njEstateDetail,
      stateInheritanceTax: njInheritance,
    };
    mockProjection({
      firstDeathEvent: decedent,
      secondDeathEvent: undefined,
      years: [{ year: 2026, hypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 50_000, admin: 0, total: 70_000 } } } }],
      todayHypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 50_000, admin: 0, total: 70_000 } } },
    });

    render(<StateDeathTaxReportView clientId="c1" {...ownerProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Sibling Doe/)).toBeInTheDocument();
    });
    // No MD callout
    expect(screen.queryByText(/inheritance.tax credit/i)).not.toBeInTheDocument();
    // Combined total still appears
    expect(screen.getByText(/Total state death tax/i)).toBeInTheDocument();
    // 50,000 + 20,000 = 70,000
    expect(screen.getAllByText(/\$70,000/).length).toBeGreaterThan(0);
  });

  it("renders grand totals across both deaths in Split view", async () => {
    const first: EstateTaxResult = {
      ...(baseEstate as EstateTaxResult),
      deceased: "client",
      year: 2042,
      residenceState: "MD",
      stateEstateTax: 130_000,
      stateEstateTaxDetail: mdEstateDetail,
      stateInheritanceTax: mdInheritance,
    };
    const secondInheritance: import("@/lib/tax/state-inheritance").StateInheritanceTaxResult = {
      ...mdInheritance,
      totalTax: 10_000,
      perRecipient: [{
        ...mdInheritance.perRecipient[0],
        tax: 10_000,
        taxableShare: 100_000,
        grossShare: 100_000,
        netToRecipient: 90_000,
        bracketLines: [{ from: 0, to: 100_000, rate: 0.1, amountTaxed: 100_000, tax: 10_000 }],
      }],
    };
    const second: EstateTaxResult = {
      ...(baseEstate as EstateTaxResult),
      deceased: "spouse",
      deathOrder: 2,
      year: 2045,
      residenceState: "MD",
      stateEstateTax: 50_000,
      stateEstateTaxDetail: {
        ...mdEstateDetail,
        stateEstateTax: 50_000,
        inheritanceCredit: { applied: true, credit: 10_000, reduction: 10_000 },
      },
      stateInheritanceTax: secondInheritance,
    };
    mockProjection({
      firstDeathEvent: first,
      secondDeathEvent: second,
      years: [{ year: 2026, hypotheticalEstateTax: null }],
      todayHypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: first,
          firstDeathTransfers: [], totals: { federal: 0, state: 0, admin: 0, total: 0 } } },
    });

    render(
      <StateDeathTaxReportView
        clientId="c1"
        isMarried
        ownerNames={{ clientName: "Alex", spouseName: "Sam" }}
        ownerDobs={{ clientDob: "1970-01-01", spouseDob: "1972-06-01" }}
        retirementYear={2035}
      />,
    );

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Split Death/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Split Death/i }));

    await waitFor(() => {
      expect(screen.getByText(/Grand totals/i)).toBeInTheDocument();
    });
    // 130_000 + 30_000 + 50_000 + 10_000 = 220_000
    expect(screen.getAllByText(/\$220,000/).length).toBeGreaterThan(0);
  });

  it("renders an empty-state legend when residence state has no death tax", async () => {
    const flDetail: import("@/lib/tax/state-estate").StateEstateTaxResult = {
      state: null,
      fallbackUsed: false, fallbackRate: 0,
      exemption: 0, exemptionYear: 0, giftAddback: 0,
      baseForTax: 0, amountOverExemption: 0, bracketLines: [],
      preCapTax: 0, stateEstateTax: 0, notes: [],
    };
    const decedent: EstateTaxResult = {
      ...(baseEstate as EstateTaxResult),
      residenceState: "FL",
      stateEstateTax: 0,
      stateEstateTaxDetail: flDetail,
      stateInheritanceTax: undefined,
    };
    mockProjection({
      firstDeathEvent: decedent,
      secondDeathEvent: undefined,
      years: [{ year: 2026, hypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 0, admin: 0, total: 0 } } } }],
      todayHypotheticalEstateTax: { year: 2026,
        primaryFirst: { firstDecedent: "client", firstDeath: decedent,
          firstDeathTransfers: [], totals: { federal: 0, state: 0, admin: 0, total: 0 } } },
    });

    render(<StateDeathTaxReportView clientId="c1" {...ownerProps} />);

    await waitFor(() => {
      expect(screen.getByText(/does not levy a state estate tax or inheritance tax/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/CT, DC, HI, IL, ME, MD, MA, MN, NY, OR, RI, VT, WA/)).toBeInTheDocument();
    expect(screen.getByText(/PA, NJ, KY, NE, MD/)).toBeInTheDocument();
  });
});
