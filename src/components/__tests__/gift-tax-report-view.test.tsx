// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import GiftTaxReportView from "../gift-tax-report-view";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { ProjectionResult } from "@/engine/projection";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const { projectionMock } = vi.hoisted(() => ({
  projectionMock: vi.fn(),
}));

vi.mock("@/engine/projection", async () => {
  const actual = await vi.importActual<typeof import("@/engine/projection")>(
    "@/engine/projection",
  );
  return {
    ...actual,
    runProjectionWithEvents: projectionMock,
  };
});

function setProjectionResult(giftLedger: GiftLedgerYear[]) {
  projectionMock.mockReturnValue({
    years: [],
    giftLedger,
  } as unknown as ProjectionResult);
}

// Minimal opaque tree fixture — engine will throw on it. The view should
// catch the error, hide the loading state, and render the error path.
// Engine-correctness is covered by gift-ledger unit tests in src/engine.
// ClientInfo fields below the bare minimum needed by buildLifeEventsByYear
// (called in a useMemo before the projection runs).
const treeFixture = {
  client: {
    firstName: "Cooper",
    lastName: "Test",
    dateOfBirth: "1973-01-01",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "married_joint",
  },
  // planSettings is required on ClientData; the drilldown reads its plan
  // horizon + inflation to build the dense annual-exclusion map (audit F2).
  planSettings: {
    planStartYear: 2026,
    planEndYear: 2060,
    inflationRate: 0.03,
    taxInflationRate: 0.025,
  },
} as unknown as Record<string, unknown>;

describe("GiftTaxReportView", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => treeFixture,
    }) as unknown as typeof fetch;

    // Default: empty ledger so existing tests keep passing.
    projectionMock.mockReturnValue({
      years: [],
      giftLedger: [],
    } as unknown as ProjectionResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    render(
      <GiftTaxReportView
        clientId="c1"
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerDobs={{ clientDob: "1973-01-01", spouseDob: "1977-01-01" }}
      />,
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("clears the loading state once fetch resolves", async () => {
    render(
      <GiftTaxReportView
        clientId="c1"
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerDobs={{ clientDob: "1973-01-01", spouseDob: "1977-01-01" }}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });
  });

  it("renders banner when any year has giftTaxThisYear > 0", async () => {
    setProjectionResult([{
      year: 2032,
      giftsGiven: 20_000_000,
      fullValueTransferred: 20_000_000,
      taxableGiftsGiven: 19_980_000,
      perGrantor: {
        client: {
          taxableGiftsThisYear: 19_980_000,
          cumulativeTaxableGifts: 19_980_000,
          creditUsed: 7_637_800,
          giftTaxThisYear: 800_000,
          cumulativeGiftTax: 800_000,
        },
        spouse: { taxableGiftsThisYear: 0, cumulativeTaxableGifts: 0, creditUsed: 0, giftTaxThisYear: 0, cumulativeGiftTax: 0 },
      },
      totalGiftTax: 800_000,
    }]);
    render(
      <GiftTaxReportView
        clientId="c1"
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerDobs={{ clientDob: "1973-01-01", spouseDob: "1977-01-01" }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Cooper/);
    expect(screen.getByRole("alert").textContent).toMatch(/2032/);
  });

  it("marks the death in the last care year of an LTC scenario, not at the plan's life expectancy", async () => {
    // Cooper (1973) in care 2058–2060; his saved life expectancy (95) is 2068.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...treeFixture,
        accounts: [], incomes: [], expenses: [], savingsRules: [], withdrawalStrategy: [],
        ltcEvents: [{
          id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566", name: "LTC", includePolicies: true,
          livingExpenseCutPct: null, homeSale: null,
          people: [{ person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 }],
        }],
      }),
    }) as unknown as typeof fetch;
    const quietYear = (year: number): GiftLedgerYear => ({
      year, giftsGiven: 0, fullValueTransferred: 0, taxableGiftsGiven: 0, totalGiftTax: 0,
      perGrantor: { client: { taxableGiftsThisYear: 0, cumulativeTaxableGifts: 0, creditUsed: 0, giftTaxThisYear: 0, cumulativeGiftTax: 0 } },
    });
    setProjectionResult([quietYear(2060), quietYear(2068)]);
    render(
      <GiftTaxReportView
        clientId="c1"
        ownerNames={{ clientName: "Cooper", spouseName: null }}
        ownerDobs={{ clientDob: "1973-01-01", spouseDob: null }}
      />,
    );
    const row2060 = await screen.findByTestId("gift-row-2060");
    expect(row2060.querySelector('[aria-label="Cooper passes"]')).not.toBeNull();
    expect(screen.getByTestId("gift-row-2068").querySelector('[aria-label="Cooper passes"]')).toBeNull();
  });

  it("a gift in a care-extended year shows the annual exclusion the engine applies", async () => {
    // John (1970) in care 2055–2057; Jane dies 2052, so the saved plan ends 2055.
    // The engine's ledger runs to 2057 and excludes the 2056 gift in full.
    const tree = buildClientData({
      client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 80 },
      planSettings: { ...basePlanSettings, planEndYear: 2055 },
      gifts: [{ id: "g-2056", year: 2056, amount: 19_000, grantor: "client", useCrummeyPowers: false }],
      ltcEvents: [{
        id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566", name: "LTC", includePolicies: true,
        livingExpenseCutPct: null, homeSale: null,
        people: [{ person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 }],
      }],
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => tree }) as unknown as typeof fetch;
    const actual = await vi.importActual<typeof import("@/engine/projection")>("@/engine/projection");
    projectionMock.mockImplementation(actual.runProjectionWithEvents);
    const engine2056 = actual.runProjectionWithEvents(tree).giftLedger.find((g) => g.year === 2056)!;
    const engineExclusion = engine2056.giftsGiven - engine2056.perGrantor.client.taxableGiftsThisYear;
    expect(engineExclusion).toBe(19_000);

    render(
      <GiftTaxReportView
        clientId="c1"
        ownerNames={{ clientName: "John", spouseName: "Jane" }}
        ownerDobs={{ clientDob: "1970-01-01", spouseDob: "1972-06-15" }}
      />,
    );
    fireEvent.click(await screen.findByTestId("gift-row-2056"));
    // Drilldown columns: Description, Full Value, Discount, Gift Value, Exclusion, Taxable Gift.
    const giftRow = screen.getByText("Gift").closest("tr")!;
    const cells = within(giftRow).getAllByRole("cell");
    expect(cells[4].textContent).toBe("$19,000");
    expect(cells[5].textContent).toBe("—"); // nothing taxable, as in the ledger
  });
});
