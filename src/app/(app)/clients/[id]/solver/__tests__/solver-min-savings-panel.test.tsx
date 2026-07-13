// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverMinSavingsPanel } from "../solver-min-savings-panel";
import type { SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";

const portfolios: SolverModelPortfolio[] = [
  { id: "p1", name: "Balanced 60/40", growthRate: 0.05,
    realization: { pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0, turnoverPct: 0 },
    mix: [{ assetClassId: "ac-1", weight: 1 }] },
];

const idle = {
  portfolios, disabled: false, phase: "idle" as const,
  progress: null, result: null,
  onSolve: vi.fn(), onIncludeSelfFunding: vi.fn(), onIncludeLockInCut: vi.fn(), onDismissResult: vi.fn(),
};

describe("SolverMinSavingsPanel", () => {
  it("opens the config box and submits portfolio + target PoS", () => {
    const onSolve = vi.fn();
    render(<SolverMinSavingsPanel {...idle} onSolve={onSolve} />);
    fireEvent.click(screen.getByRole("button", { name: /Solve minimum additional savings/i }));
    fireEvent.change(screen.getByLabelText(/Invest savings in/i), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText(/Target success/i), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: /^Solve$/i }));
    expect(onSolve).toHaveBeenCalledWith("p1", 0.9);
  });

  it("renders the outcome with both include buttons and wires them", () => {
    const onSelf = vi.fn();
    const onLock = vi.fn();
    render(
      <SolverMinSavingsPanel
        {...idle}
        phase="result"
        result={{
          status: "converged", savings: 24500, portfolioName: "Balanced 60/40",
          startYear: 2026, endYear: 2039, targetPoS: 0.85,
          baselineLiving: 120000, updatedLiving: 108300, fromCashFlow: 12800, fromExpenseReduction: 11700,
        }}
        onIncludeSelfFunding={onSelf}
        onIncludeLockInCut={onLock}
      />,
    );
    expect(screen.getByText(/24,500/)).toBeInTheDocument();
    expect(screen.getByText(/108,300/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save flexibly/i }));
    expect(onSelf).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Lock in a fixed budget/i }));
    expect(onLock).toHaveBeenCalled();
  });

  it("shows an unreachable note when status is unreachable", () => {
    render(
      <SolverMinSavingsPanel
        {...idle}
        phase="result"
        result={{
          status: "unreachable", savings: 100000, portfolioName: "Balanced 60/40",
          startYear: 2026, endYear: 2039, targetPoS: 0.85,
          baselineLiving: 120000, updatedLiving: 20000, fromCashFlow: 0, fromExpenseReduction: 100000,
        }}
      />,
    );
    expect(screen.getByText(/Couldn't reach/i)).toBeInTheDocument();
  });

  it("disables the trigger when disabled or no portfolios", () => {
    const { rerender } = render(<SolverMinSavingsPanel {...idle} disabled />);
    expect(screen.getByRole("button", { name: /Solve minimum additional savings/i })).toBeDisabled();
    rerender(<SolverMinSavingsPanel {...idle} portfolios={[]} />);
    expect(screen.getByRole("button", { name: /Solve minimum additional savings/i })).toBeDisabled();
  });
});
