// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GrowthInflationForm from "../growth-inflation-form";
import { ClientAccessProvider } from "@/components/client-access-provider";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details",
}));

// ── Fixture ───────────────────────────────────────────────────────────────────
// Minimal valid props for GrowthInflationForm — every field it requires
// (non-optional) plus the ones exercised by these tests.

const BASE_PROPS = {
  clientId: "test-client-id",
  inflationRate: "0.03",
  inflationRateSource: "custom" as const,
  resolvedInflationRate: 0.03,
  assetClassInflationRate: 0.03,
  hasInflationAssetClass: true,
  defaultGrowthTaxable: "0.05",
  defaultGrowthCash: "0.01",
  defaultGrowthRetirement: "0.05",
  defaultGrowthRealEstate: "0.03",
  defaultGrowthBusiness: "0.03",
  defaultGrowthLifeInsurance: "0.03",
  medicarePremiumInflationEnabled: false,
};

function renderForm(overrides?: Partial<React.ComponentProps<typeof GrowthInflationForm>>) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <GrowthInflationForm {...BASE_PROPS} {...overrides} />
    </ClientAccessProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
// Risk tolerance moved from an editable <select> + "Apply to portfolios"
// button here to a read-only display -- mutating it now happens on
// /risk/[clientId] (Tasks 10-13). This tab only shows the current composite
// level and links out.

describe("GrowthInflationForm — risk tolerance display", () => {
  it("shows the composite level read-only, with a link to the risk profile", () => {
    renderForm({ riskLevel: "moderate" });

    expect(screen.getByText("Moderate")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /manage risk profile/i });
    expect(link).toHaveAttribute("href", "/risk/test-client-id");
  });

  it("shows 'Not established' when no risk level is set", () => {
    renderForm({ riskLevel: null });
    expect(screen.getByText("Not established")).toBeInTheDocument();
  });
});

// ── Autosave ──────────────────────────────────────────────────────────────────

/** The form debounces before it saves; fake timers step past that. */
async function settleAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

describe("GrowthInflationForm — autosave", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("has no Save button — but keeps the account-reset action, which is not a save", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /reset all accounts/i })).toBeInTheDocument();
  });

  it("sends only the rate that changed", async () => {
    renderForm();

    fireEvent.change(document.getElementById("defaultGrowthTaxable")!, { target: { value: "6" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ defaultGrowthTaxable: "0.06" });
  });

  // The category dropdowns quote the inflation rate. Reading it back from the
  // server would leave the labels a request behind the box the advisor is
  // typing in, so the form derives it locally.
  it("retitles the Inflation option as the custom rate is typed", async () => {
    renderForm({ inflationRateSource: "custom", inflationRate: "0.03" });
    expect(screen.getAllByRole("option", { name: "Inflation (3.00%)" }).length).toBeGreaterThan(0);

    fireEvent.change(document.getElementById("inflationRate")!, { target: { value: "4.5" } });

    expect(screen.getAllByRole("option", { name: "Inflation (4.50%)" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("option", { name: "Inflation (3.00%)" })).toHaveLength(0);
  });

  it("sends the source and the portfolio id together when a category switches to a model portfolio", async () => {
    renderForm({
      modelPortfolios: [
        { id: "mp-1", name: "Balanced", blendedReturn: 0.06, riskLevel: "moderate" },
      ],
    });

    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "mp:mp-1" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      growthSourceTaxable: "model_portfolio",
      modelPortfolioIdTaxable: "mp-1",
    });
  });

  it("clears the stored portfolio id when a category moves off a model portfolio", async () => {
    renderForm({
      growthSourceTaxable: "model_portfolio",
      modelPortfolioIdTaxable: "mp-1",
      modelPortfolios: [
        { id: "mp-1", name: "Balanced", blendedReturn: 0.06, riskLevel: "moderate" },
      ],
    });

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "custom" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.growthSourceTaxable).toBe("custom");
    expect(body.modelPortfolioIdTaxable).toBeNull();
  });
});

// ── Inflation source rows ─────────────────────────────────────────────────────
// The "Asset class" row quotes the rate that option would resolve to. It must
// come from the firm/client asset class, NOT from `resolvedInflationRate` --
// that prop collapses to the *custom* rate whenever the source is custom, so
// the row used to claim the asset class was whatever the advisor had typed.

describe("GrowthInflationForm — inflation source rows", () => {
  it("quotes the asset-class rate on the Asset class row while Custom is selected", () => {
    renderForm({
      inflationRateSource: "custom",
      inflationRate: "0.03",
      resolvedInflationRate: 0.03,
      assetClassInflationRate: 0.025,
    });

    const assetClassRow = screen.getByRole("radio", { name: /asset class/i }).closest("label");
    expect(assetClassRow).toHaveTextContent("2.50%");
    expect(assetClassRow).not.toHaveTextContent("3.00%");
  });

  it("quotes the asset-class rate on the Asset class row while Asset class is selected", () => {
    renderForm({
      inflationRateSource: "asset_class",
      inflationRate: "0.03",
      resolvedInflationRate: 0.025,
      assetClassInflationRate: 0.025,
    });

    const assetClassRow = screen.getByRole("radio", { name: /asset class/i }).closest("label");
    expect(assetClassRow).toHaveTextContent("2.50%");
  });
});
