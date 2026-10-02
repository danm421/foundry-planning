// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { runProjection } from "@/engine/projection";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";
import type { ClientData } from "@/engine/types";
import type { SolverMutation, SolverMutationKey } from "@/lib/solver/types";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { LtcStressRow } from "../solver-stress-ltc-row";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ base, scenarioId = null }: { base: ClientData; scenarioId?: string | null }) {
  const [muts, setMuts] = useState<SolverMutation[]>([]);
  const tree = applyMutations(base, muts);
  return (
    <LtcStressRow
      tree={tree}
      projectionYears={runProjection(tree)}
      scenarioId={scenarioId}
      scenarioName={scenarioId ? "With care" : null}
      clientId="c1"
      savedChange={null}
      onChange={(m) => setMuts((prev) => [...prev.filter((p) => p.kind !== m.kind), m])}
      onResetField={(keys: SolverMutationKey[]) => setMuts((prev) => prev.filter((p) => !keys.includes(p.kind as SolverMutationKey)))}
      onSaved={vi.fn()}
      onEditOnChangesTab={vi.fn()}
    />
  );
}

const plan = buildClientData({
  client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
  planSettings: { ...basePlanSettings, planEndYear: 2067 },
});

/** The value printed next to a label in the home-sale summary. */
function valueNextTo(label: RegExp): string {
  const term = screen.getAllByText(label).find((el) => el.tagName === "DT");
  return term!.nextElementSibling!.textContent!;
}

describe("LtcStressRow (draft)", () => {
  it("toggling on shows the default event and its care span", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    expect(screen.getByText(/Care 2055–2057 \(ages 85–87\)/)).toBeTruthy();
    // Not "John's plan ends": for a couple the plan carries on for the spouse.
    expect(screen.getByText(/Life expectancy set to 87 \(2057\)/)).toBeTruthy();
  });

  it("picking a care setting fills its 2025 median cost", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    fireEvent.change(screen.getByLabelText(/care setting/i), { target: { value: "assisted_living" } });
    expect((screen.getByLabelText(/yearly cost/i) as HTMLInputElement).value).toBe("74,400");
  });

  it("a start age already passed shows the warning and applies nothing", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    expect(screen.getByText(/Care 2055–2057/)).toBeTruthy();
    const age = screen.getByLabelText(/starts at age/i);
    fireEvent.change(age, { target: { value: "40" } });
    fireEvent.blur(age);
    expect(screen.getByText(/already passed/i)).toBeTruthy();
    // The skipped person gets no care span and no life-expectancy claim.
    expect(screen.queryByText(/Care \d{4}/)).toBeNull();
    expect(screen.queryByText(/Life expectancy set to/)).toBeNull();
  });

  it("the home sale preview shows projected value, mortgage left and cash", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sell the home/i }));
    expect(screen.getByText(/Projected value in 2055/)).toBeTruthy();
    expect(screen.getByText(/Mortgage left/)).toBeTruthy();
    expect(screen.getByText(/Estimated cash to the household/)).toBeTruthy();
  });

  it("a home with no mortgage shows $0 left and cash equal to price minus costs", () => {
    render(<Harness base={{ ...plan, liabilities: [] }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sell the home/i }));
    fireEvent.click(screen.getByRole("radio", { name: /custom amount/i }));
    const price = screen.getByLabelText(/sale price/i);
    fireEvent.change(price, { target: { value: "1000000" } });
    fireEvent.blur(price);
    expect(valueNextTo(/^Mortgage left$/)).toBe("$0");
    expect(valueNextTo(/^Selling costs$/)).toBe("$60,000");
    expect(valueNextTo(/Estimated cash to the household/)).toBe("$940,000 before tax");
  });

  it("a sale year past the last projected year is pulled back to it, with real figures", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sell the home/i }));
    // The couple's plan runs to 2067 (Jane outlives the care), so that is the last projected year.
    const year = screen.getByLabelText(/sale year/i) as HTMLInputElement;
    fireEvent.change(year, { target: { value: "2090" } });
    fireEvent.blur(year);
    expect(screen.getByText(/Projected value in 2067/)).toBeTruthy();
    expect(valueNextTo(/^Mortgage left$/)).not.toBe("—");
    expect(valueNextTo(/Estimated cash to the household/)).toMatch(/^\$[\d,]+ before tax$/);
    expect(screen.queryByText(/Projected value in 2090/)).toBeNull();
  });

  it("a second out-of-range sale year is pulled back too — the box never disagrees with the figures", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sell the home/i }));
    for (let i = 0; i < 2; i++) {
      const year = screen.getByLabelText(/sale year/i) as HTMLInputElement;
      fireEvent.change(year, { target: { value: "2090" } });
      fireEvent.blur(year);
      expect((screen.getByLabelText(/sale year/i) as HTMLInputElement).value).toBe("2067");
    }
    expect(screen.getByText(/Projected value in 2067/)).toBeTruthy();
  });

  it("when nobody's care falls in the plan, the cut and the sale show no figures and say why", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /cut living expenses/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sell the home/i }));
    expect(screen.getByText(/Estimated cash to the household/)).toBeTruthy();
    const age = screen.getByLabelText(/starts at age/i);
    fireEvent.change(age, { target: { value: "40" } });
    fireEvent.blur(age);
    // The engine drops the sale and the cut with nobody in care: no figures for them.
    expect(screen.queryByText(/Projected value in/)).toBeNull();
    expect(screen.queryByText(/Estimated cash to the household/)).toBeNull();
    const fieldsetOf = (name: RegExp) => screen.getByRole("checkbox", { name }).closest("fieldset")!;
    expect(within(fieldsetOf(/cut living expenses/i)).getByText(/already passed/i)).toBeTruthy();
    expect(within(fieldsetOf(/sell the home/i)).getByText(/already passed/i)).toBeTruthy();
  });

  it("a view-only advisor can't Add as change", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <Harness base={plan} scenarioId="s1" />
      </ClientAccessProvider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    expect((screen.getByRole("button", { name: /add as change/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("on the base case, Add as change is disabled and says why", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    const btn = screen.getByRole("button", { name: /add as change/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Pick or create a scenario first/)).toBeTruthy();
  });
});

const savedEvent = {
  id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566",
  name: "Long-term care — John 85–87",
  people: [{ person: "client" as const, startAge: 85, years: 3, careSetting: "nursing_private" as const, annualCost: 129_575, costInflation: 0.05 }],
  livingExpenseCutPct: null, homeSale: null, includePolicies: true,
};
const saved = (enabled: boolean): ChangesPanelChange => ({
  id: "chg-1", scenarioId: "s1", opType: "add", targetKind: "ltc_event", targetId: savedEvent.id,
  payload: savedEvent, toggleGroupId: null, orderIndex: 0, updatedAt: new Date(), enabled, label: null,
} as ChangesPanelChange);

describe("LtcStressRow (saved)", () => {
  it("Add as change POSTs the event and refreshes; the workspace, not the row, drops the draft", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onSaved = vi.fn();
    const onResetField = vi.fn();
    const tree = applyMutations(plan, [{ kind: "stress-ltc", value: savedEvent }]);
    render(
      <LtcStressRow tree={tree} projectionYears={runProjection(tree)} scenarioId="s1" scenarioName="With care"
        clientId="c1" savedChange={null} onChange={vi.fn()} onResetField={onResetField}
        onSaved={onSaved} onEditOnChangesTab={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add as change/i }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/c1/scenarios/s1/changes");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ op: "add", targetKind: "ltc_event", entity: savedEvent });
    // Dropping the draft here, before the refreshed change list arrives, left a
    // window to re-tick and add a second event. The workspace drops it once the
    // saved change is in the list (live-solver-workspace.test.tsx).
    expect(onResetField).not.toHaveBeenCalled();
  });

  it("a saved event shows a read-only summary and Edit on Changes tab — no second Add", () => {
    const onEdit = vi.fn();
    render(
      <LtcStressRow tree={plan} projectionYears={[]} scenarioId="s1" scenarioName="With care" clientId="c1"
        savedChange={saved(true)} onChange={vi.fn()} onResetField={vi.fn()} onSaved={vi.fn()} onEditOnChangesTab={onEdit} />,
    );
    expect(screen.getByText("Long-term care — John 85–87")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add as change/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /edit on changes tab/i }));
    expect(onEdit).toHaveBeenCalledWith("chg-1");
  });

  it("a SWITCHED-OFF saved event still shows as saved (switched off) — no second Add", () => {
    render(
      <LtcStressRow tree={plan} projectionYears={[]} scenarioId="s1" scenarioName="With care" clientId="c1"
        savedChange={saved(false)} onChange={vi.fn()} onResetField={vi.fn()} onSaved={vi.fn()} onEditOnChangesTab={vi.fn()} />,
    );
    expect(screen.getByText(/switched off/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add as change/i })).toBeNull();
    // A switched-off change opens no editor, so the link doesn't promise one.
    expect(screen.queryByRole("button", { name: /edit on changes tab/i })).toBeNull();
    expect(screen.getByRole("button", { name: /switch it on in the changes tab/i })).toBeTruthy();
  });

  // I3 / R34 — the engine drops the parts of a saved event it can't apply; the
  // saved row says which, while the event is on.
  const homeGone = { ...savedEvent, homeSale: { accountId: "gone", saleYear: 2055, price: { mode: "projected" as const }, sellingCostPct: 0.06 } };
  const savedWith = (enabled: boolean): ChangesPanelChange => ({ ...saved(enabled), payload: homeGone });

  it("a saved event that is ON shows the engine's warnings", () => {
    const tree = { ...plan, ltcEvents: [homeGone] };
    render(
      <LtcStressRow tree={tree} projectionYears={[]} scenarioId="s1" scenarioName="With care" clientId="c1"
        savedChange={savedWith(true)} onChange={vi.fn()} onResetField={vi.fn()} onSaved={vi.fn()} onEditOnChangesTab={vi.fn()} />,
    );
    expect(screen.getByRole("status").textContent).toBe("The home picked for the sale is no longer in this plan.");
  });

  it("a saved event that is switched OFF shows no warnings", () => {
    // Off, the scenario doesn't apply the event, so the tree carries none.
    render(
      <LtcStressRow tree={plan} projectionYears={[]} scenarioId="s1" scenarioName="With care" clientId="c1"
        savedChange={savedWith(false)} onChange={vi.fn()} onResetField={vi.fn()} onSaved={vi.fn()} onEditOnChangesTab={vi.fn()} />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a failed save says so and keeps the draft", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 400 }));
    const onResetField = vi.fn();
    const tree = applyMutations(plan, [{ kind: "stress-ltc", value: savedEvent }]);
    render(
      <LtcStressRow tree={tree} projectionYears={runProjection(tree)} scenarioId="s1" scenarioName="With care"
        clientId="c1" savedChange={null} onChange={vi.fn()} onResetField={onResetField} onSaved={vi.fn()} onEditOnChangesTab={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add as change/i }));
    expect(await screen.findByText(/couldn.t save/i)).toBeTruthy();
    expect(onResetField).not.toHaveBeenCalled();
  });
});
