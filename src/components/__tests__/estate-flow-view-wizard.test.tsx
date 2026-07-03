// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildClientData } from "@/engine/__tests__/fixtures";
import { ClientAccessProvider } from "@/components/client-access-provider";
import EstateFlowView from "@/components/estate-flow-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/client-1/onboarding/estate",
}));

// The chart/comparison tabs pull presentation-heavy deps the variant logic
// under test never renders. Stub them so jsdom stays fast and safe.
vi.mock("@/components/estate-flow-chart-tab", () => ({
  EstateFlowChartTab: () => <div data-testid="chart-tab" />,
}));
vi.mock("@/components/estate-flow-comparison-tab", () => ({
  EstateFlowComparisonTab: () => <div data-testid="comparison-tab" />,
}));

function renderView(embed?: "page" | "wizard") {
  const data = buildClientData();
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <EstateFlowView
        embed={embed}
        clientId="client-1"
        scenarioId="base"
        scenarioName="Base case"
        isMarried={false}
        ownerNames={{ clientName: "Alex", spouseName: null }}
        initialClientData={data}
        initialGifts={[]}
        cpi={0.03}
      />
    </ClientAccessProvider>,
  );
}

describe("EstateFlowView wizard variant", () => {
  it("hides the tab strip and page h1, keeps the report controls", () => {
    renderView("wizard");
    expect(screen.queryByText("Flow Chart")).toBeNull();
    expect(screen.queryByText("Comparison")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Estate Flow" })).toBeNull();
    // Remainder estate button proves the control bar + edit affordances render.
    expect(screen.getByRole("button", { name: /remainder estate/i })).toBeDefined();
  });

  it("full variant (default) still renders the tab strip and h1", () => {
    renderView();
    expect(screen.getByText("Flow Chart")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Estate Flow" })).toBeDefined();
  });
});
