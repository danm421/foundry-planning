// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { SolverMutation } from "@/lib/solver/types";
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

function renderTech(
  over: {
    baseGifts?: EstateFlowGift[];
    onOpen?: () => void;
    onChange?: (m: SolverMutation) => void;
  } = {},
) {
  const base = tree();
  const onChange = over.onChange ?? vi.fn();
  render(
    <SolverEstateTechnique
      baseClientData={base}
      clientData={base}
      baseGifts={over.baseGifts ?? []}
      onChange={onChange}
      onOpen={over.onOpen}
    />,
  );
  return { onChange };
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
    const dialog = screen.getByRole("dialog", { name: /estate planning/i });
    expect(within(dialog).getByText(/Cash gift 2030/)).toBeInTheDocument();
  });

  it("keeps a base gift visible after closing and reopening the editor (lossless)", () => {
    renderTech({ baseGifts: [gift] });
    fireEvent.click(screen.getByRole("button", { name: /edit estate/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Done$/ }));
    fireEvent.click(screen.getByRole("button", { name: /edit estate/i }));
    const dialog = screen.getByRole("dialog", { name: /estate planning/i });
    expect(within(dialog).getByText(/Cash gift 2030/)).toBeInTheDocument();
  });

  it("shows inline gift toggles in the Techniques area without opening the editor", () => {
    renderTech({ baseGifts: [gift] });
    // The modal is closed…
    expect(screen.queryByRole("dialog", { name: /estate planning/i })).toBeNull();
    // …yet the gift's on/off toggle + summary are visible inline.
    expect(
      screen.getByRole("switch", { name: /include family gift/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cash gift 2030/)).toBeInTheDocument();
  });

  it("emits a gift-upsert disable mutation when an inline toggle is flipped", () => {
    const onChange = vi.fn();
    renderTech({ baseGifts: [gift], onChange });
    fireEvent.click(screen.getByRole("switch", { name: /include family gift/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "gift-upsert", id: "g1" }),
    );
    expect(onChange.mock.calls[0][0].value).toMatchObject({ enabled: false });
  });

  it("renders no inline gift toggles when there are no planned gifts", () => {
    renderTech();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
