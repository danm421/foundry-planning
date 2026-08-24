// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ClientData } from "@/engine/types";
import { MAX_RATE_STRESS_POINTS } from "@/lib/tax/rate-stress";
import { SolverStressTestTab } from "../solver-stress-test-tab";

const CURRENT_YEAR = 2026;

function tree(over: {
  taxRateStress?: { points: number; startYear: number };
  taxEngineMode?: "flat" | "bracket";
} = {}): ClientData {
  return {
    client: {
      firstName: "John", lastName: "Smith", dateOfBirth: "1970-01-01",
      retirementAge: 65, planEndAge: 90, filingStatus: "married_joint",
      spouseName: "Jane Smith", spouseDob: "1972-06-15", spouseRetirementAge: 65,
    },
    planSettings: {
      flatFederalRate: 0.22, flatStateRate: 0.05, inflationRate: 0.03,
      planStartYear: 2026, planEndYear: 2055,
      // `"taxEngineMode" in over` distinguishes "not passed" (defaults to the
      // bracket engine every other test in this file assumes) from "passed as
      // undefined" (the unset-plan case Ruling 13 exists to cover).
      taxEngineMode: "taxEngineMode" in over ? over.taxEngineMode : "bracket",
      taxRateStress: over.taxRateStress,
    },
    accounts: [], incomes: [], expenses: [], liabilities: [],
    savingsRules: [], withdrawalStrategy: [], familyMembers: [],
    giftEvents: [], disabilityPolicies: [],
  } as unknown as ClientData;
}

function renderTab(over: Parameters<typeof tree>[0] = {}) {
  const onChange = vi.fn();
  const onResetField = vi.fn();
  render(
    <SolverStressTestTab
      baseClientData={tree()}
      workingTree={tree(over)}
      currentYear={CURRENT_YEAR}
      clientName="John"
      spouseName="Jane"
      onChange={onChange as never}
      onResetField={onResetField}
    />,
  );
  return { onChange, onResetField };
}

afterEach(cleanup);

const ROW = { name: /tax rates rise/i } as const;

describe("Tax rates rise stressor", () => {
  it("emits the default mutation when toggled on", () => {
    const { onChange } = renderTab();
    fireEvent.click(screen.getByRole("checkbox", ROW));
    expect(onChange).toHaveBeenCalledWith({
      kind: "stress-tax-rates",
      points: 0.03,
      startYear: CURRENT_YEAR + 1,
    });
  });

  it("resets the field when toggled off", () => {
    const { onResetField } = renderTab({ taxRateStress: { points: 0.03, startYear: 2030 } });
    fireEvent.click(screen.getByRole("checkbox", ROW));
    expect(onResetField).toHaveBeenCalledWith(["stress-tax-rates"]);
  });

  it("derives its checked state and field values from the working tree", () => {
    renderTab({ taxRateStress: { points: 0.05, startYear: 2032 } });
    expect(screen.getByRole("checkbox", ROW)).toBeChecked();
    // PercentField renders a decimal as whole percent: 0.05 -> "5".
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2032")).toBeInTheDocument();
  });

  it("commits an edited rate without losing the start year", () => {
    const { onChange } = renderTab({ taxRateStress: { points: 0.03, startYear: 2032 } });
    fireEvent.blur(screen.getByDisplayValue("3"), { target: { value: "6" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "stress-tax-rates",
      points: 0.06,
      startYear: 2032,
    });
  });

  it("clamps a rate increase above the ceiling", () => {
    const { onChange } = renderTab({ taxRateStress: { points: 0.03, startYear: 2032 } });
    fireEvent.blur(screen.getByDisplayValue("3"), { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "stress-tax-rates",
      points: MAX_RATE_STRESS_POINTS,
      startYear: 2032,
    });
  });

  // Stored points (0.05) deliberately differs from DEFAULT_TAX_RATE_POINTS
  // (0.03): a handler that hardcoded the default instead of reading the
  // stored value would still pass if this fixture matched the default.
  it("commits an edited start year without losing the rate", () => {
    const { onChange } = renderTab({ taxRateStress: { points: 0.05, startYear: 2032 } });
    fireEvent.blur(screen.getByDisplayValue("2032"), { target: { value: "2035" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "stress-tax-rates",
      points: 0.05,
      startYear: 2035,
    });
  });

  it("disables the row in flat tax mode", () => {
    renderTab({ taxEngineMode: "flat" });
    const box = screen.getByRole("checkbox", ROW);
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
  });

  // Ruling 13: taxEngineMode is OPTIONAL and unset means flat (projection.ts
  // routes on `=== "bracket"`). A `!== "flat"` check would leave this row live
  // on an unset plan the engine actually runs flat — a stressor an advisor sets
  // that silently does nothing.
  it("disables the row when taxEngineMode is unset (unset means flat)", () => {
    renderTab({ taxEngineMode: undefined });
    expect(screen.getByRole("checkbox", ROW)).toBeDisabled();
  });

  it("hides the parameter fields in flat mode even when a stressor is stored", () => {
    // The `on && !disabled` guard. Without it a flat-mode plan carrying a
    // stressor from a saved scenario would render live-looking inputs that
    // change a number the engine cannot read.
    renderTab({ taxEngineMode: "flat", taxRateStress: { points: 0.03, startYear: 2030 } });
    expect(screen.queryByDisplayValue("2030")).not.toBeInTheDocument();
  });

  // Ruling 17: FieldTooltip's `role="tooltip"` span is always in the DOM
  // (jsdom applies no Tailwind, so the hover-only classes don't hide it here).
  // The reason text is queryable, not just visually present on hover.
  it("shows the reason when disabled", () => {
    renderTab({ taxEngineMode: "flat" });
    expect(screen.getByText(/unavailable in flat tax mode/i)).toBeInTheDocument();
  });
});
