// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { runProjection } from "@/engine/projection";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";
import type { ClientData } from "@/engine/types";
import type { SolverMutation, SolverMutationKey } from "@/lib/solver/types";
import { LtcStressRow } from "../solver-stress-ltc-row";

afterEach(cleanup);

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

  it("on the base case, Add as change is disabled and says why", () => {
    render(<Harness base={plan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /long-term care/i }));
    const btn = screen.getByRole("button", { name: /add as change/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Pick or create a scenario first/)).toBeTruthy();
  });
});
