// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
