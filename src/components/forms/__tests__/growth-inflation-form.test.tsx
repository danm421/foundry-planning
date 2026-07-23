// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
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

// Category rows have no <label htmlFor> association — locate each category's
// <select> via its visible label text and the shared ROW_GRID ancestor.
function categorySelect(label: string): HTMLSelectElement {
  return screen.getByText(label).closest(".grid")!.querySelector("select") as HTMLSelectElement;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GrowthInflationForm — risk tolerance control", () => {
  it("Apply fills taxable+retirement from the tagged portfolio, leaves cash", () => {
    renderForm({
      modelPortfolios: [{ id: "pf1", name: "Mod", blendedReturn: 0.06, riskLevel: "moderate" }],
    });

    fireEvent.change(screen.getByLabelText(/risk tolerance/i), { target: { value: "moderate" } });
    fireEvent.click(screen.getByRole("button", { name: /apply to portfolios/i }));

    expect(categorySelect("Taxable").value).toBe("mp:pf1");
    expect(categorySelect("Retirement").value).toBe("mp:pf1");
    // Cash is deliberately untouched — still whatever it defaulted to.
    expect(categorySelect("Cash").value).toBe("custom");
  });

  it("shows an untagged note when the chosen rung has no tagged portfolio, and Apply is a no-op", () => {
    renderForm({
      modelPortfolios: [{ id: "pf1", name: "Mod", blendedReturn: 0.06, riskLevel: "moderate" }],
    });

    fireEvent.change(screen.getByLabelText(/risk tolerance/i), { target: { value: "aggressive" } });

    expect(screen.getByText(/No Aggressive model tagged/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /apply to portfolios/i }));
    expect(categorySelect("Taxable").value).toBe("custom");
    expect(categorySelect("Retirement").value).toBe("custom");
  });

  it("does not render the untagged note when nothing is selected", () => {
    renderForm({
      modelPortfolios: [{ id: "pf1", name: "Mod", blendedReturn: 0.06, riskLevel: "moderate" }],
    });
    expect(screen.queryByText(/model tagged/i)).not.toBeInTheDocument();
  });
});
