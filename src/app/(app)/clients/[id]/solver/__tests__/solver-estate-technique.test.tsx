// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { SolverEstateTechnique } from "../solver-estate-technique";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1",
}));

const planSettings = { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025, taxInflationRate: 0.025 };
function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { spouseDob: null },
    accounts: [], entities: [], externalBeneficiaries: [], incomes: [], expenses: {},
    savingsRules: [], liabilities: [], gifts: [], giftEvents: [], taxYearRows: [],
    planSettings, ...over,
  } as unknown as ClientData;
}
const gift: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2030, amount: 10000, grantor: "client",
  recipient: { kind: "family_member", id: "f1" }, crummey: false,
};

function renderTech(over: { baseGifts?: EstateFlowGift[]; onOpen?: () => void } = {}) {
  const base = tree();
  return render(
    <SolverEstateTechnique
      baseClientData={base}
      clientData={base}
      baseGifts={over.baseGifts ?? []}
      onChange={vi.fn()}
      onOpen={over.onOpen}
    />,
  );
}

describe("SolverEstateTechnique", () => {
  it("shows a 'Not configured' summary when empty and opens the editor on Edit", () => {
    renderTech();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    // The modal is closed initially.
    expect(screen.queryByRole("dialog", { name: /estate planning/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /edit estate/i }));
    expect(screen.getByRole("dialog", { name: /estate planning/i })).toBeInTheDocument();
  });

  it("summarises a configured plan and fires onOpen when the editor is opened", () => {
    const onOpen = vi.fn();
    renderTech({ baseGifts: [gift], onOpen });
    expect(screen.getByText(/1 gift/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /edit estate/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    // The gift row is present inside the open editor.
    expect(screen.getByText(/Cash gift 2030/)).toBeInTheDocument();
  });

  it("keeps a base gift visible after closing and reopening the editor (lossless)", () => {
    renderTech({ baseGifts: [gift] });
    fireEvent.click(screen.getByRole("button", { name: /edit estate/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Done$/ }));
    fireEvent.click(screen.getByRole("button", { name: /edit estate/i }));
    expect(screen.getByText(/Cash gift 2030/)).toBeInTheDocument();
  });
});
