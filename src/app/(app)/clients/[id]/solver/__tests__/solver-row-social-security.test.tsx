// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClientData, Income } from "@/engine";
import { ssAmountLabel, ssDetailRows, SolverRowSocialSecurity } from "../solver-row-social-security";

function ssRow(p: Partial<Income>): Income {
  return {
    id: "ss",
    type: "social_security",
    owner: "client",
    annualAmount: 0,
    ssBenefitMode: "pia_at_fra",
    piaMonthly: 3600,
    claimingAgeMode: "fra",
    growthRate: 0.02,
    ...p,
  } as Income;
}

const client = { firstName: "Cooper", retirementAge: 65 } as ClientData["client"];

describe("ssAmountLabel", () => {
  it("renders the PIA headline", () => {
    expect(ssAmountLabel(ssRow({}), client)).toBe("$3,600/mo PIA");
  });
  it("renders a stated amount with the age it is quoted at", () => {
    expect(ssAmountLabel(ssRow({ ssBenefitMode: "manual_amount", annualAmount: 30000 }), client)).toBe(
      "$30,000/yr at 67",
    );
  });
  it("renders No benefit", () => {
    expect(ssAmountLabel(ssRow({ ssBenefitMode: "no_benefit" }), client)).toBe("No benefit");
  });
});

describe("ssDetailRows", () => {
  it("returns Claim at + COLA rows", () => {
    expect(ssDetailRows(ssRow({}), client, "client")).toEqual([
      { term: "Entered", value: "$3,600/mo PIA" },
      { term: "Claim at", value: "FRA" },
      { term: "COLA", value: "2%" },
    ]);
  });
  it("formats a specific claim age", () => {
    const rows = ssDetailRows(
      ssRow({ claimingAgeMode: "years", claimingAge: 70, claimingAgeMonths: 0, growthRate: undefined }),
      client,
      "client",
    );
    expect(rows).toEqual([
      { term: "Entered", value: "$3,600/mo PIA" },
      { term: "Claim at", value: "70" },
    ]);
  });
  it("is empty for no_benefit", () => {
    expect(ssDetailRows(ssRow({ ssBenefitMode: "no_benefit" }), client, "client")).toEqual([]);
  });
});

describe("SolverRowSocialSecurity — benefit at the claim age", () => {
  // Born 1960: FRA 67, so 70 earns 36 delayed months at 2/3% each = +24%.
  const cooper = { firstName: "Cooper", dateOfBirth: "1960-07-16", retirementAge: 65 } as ClientData["client"];

  function renderRow(row: Income, onChange = vi.fn()) {
    const props = {
      baseIncomes: [row],
      workingIncomes: [row],
      baseClient: cooper,
      workingClient: cooper,
      onChange,
      activeSolve: null,
      onSolveStart: vi.fn(),
      onSolveCancel: vi.fn(),
    };
    const view = render(<SolverRowSocialSecurity {...props} />);
    return {
      onChange,
      rerenderWith: (working: Income) =>
        view.rerender(<SolverRowSocialSecurity {...props} workingIncomes={[working]} />),
    };
  }
  const amount = () => screen.getByLabelText("Cooper's SS benefit at claim age") as HTMLInputElement;
  const age = () => screen.getByLabelText("Cooper's SS claim age") as HTMLSelectElement;

  it("shows the PIA priced at the claim age, and re-prices as the age moves", () => {
    const row = ssRow({ piaMonthly: 3000, claimingAgeMode: "years", claimingAge: 67 });
    const { rerenderWith } = renderRow(row);
    expect(amount().value).toBe("3,000");
    expect(age().value).toBe(String(67 * 12));
    rerenderWith({ ...row, claimingAge: 70 });
    expect(amount().value).toBe("3,720");
  });

  it("picking an age moves an FRA claim onto that age", () => {
    const { onChange } = renderRow(ssRow({ piaMonthly: 3000 }));
    fireEvent.change(age(), { target: { value: String(70 * 12) } });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { kind: "ss-claim-age-mode", person: "client", mode: "years" },
      { kind: "ss-claim-age", person: "client", age: 70, months: 0 },
    ]);
  });

  it("typing the benefit at the claim age stores the PIA it implies", () => {
    const { onChange } = renderRow(ssRow({ piaMonthly: 3000, claimingAgeMode: "years", claimingAge: 70 }));
    fireEvent.change(amount(), { target: { value: "4,340" } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "ss-pia-monthly", person: "client", amount: 3500 });
  });

  it("pins a stated benefit's age before moving the claim, so the dollars re-price", () => {
    // Legacy row: $36,000/yr with no stated age — quoted at the claim age, 67.
    const row = ssRow({
      ssBenefitMode: "manual_amount", piaMonthly: undefined, annualAmount: 36000,
      claimingAgeMode: "years", claimingAge: 67,
    });
    const { onChange } = renderRow(row);
    expect(amount().value).toBe("36,000");
    fireEvent.change(age(), { target: { value: String(70 * 12) } });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { kind: "ss-stated-age", person: "client", age: 67, months: 0 },
      { kind: "ss-claim-age", person: "client", age: 70, months: 0 },
    ]);
  });

  it("falls back to the editor button when nothing can be priced", () => {
    renderRow(ssRow({ ssBenefitMode: "no_benefit" }));
    expect(screen.queryByLabelText("Cooper's SS claim age")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Cooper's SS" }).textContent).toContain("No benefit");
  });
});
