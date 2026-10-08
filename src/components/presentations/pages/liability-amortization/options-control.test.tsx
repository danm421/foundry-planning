// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import type { LiabilityPickerOption } from "@/lib/presentations/liability-picker-options";
import type { LiabilityAmortizationPageOptions } from "@/lib/presentations/pages/liability-amortization/types";
import { LiabilityAmortizationOptionsControl } from "./options-control";

const loans: LiabilityPickerOption[] = [
  { id: "m", name: "Mortgage", balance: 412_000 },
  { id: "a", name: "Car loan", balance: 22_000 },
];

function wrap(value: LiabilityAmortizationPageOptions, onChange = vi.fn(), list = loans) {
  const utils = render(
    <PresentationOptionsProvider
      value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios: [], clientId: "c1", liabilities: list }}
    >
      <LiabilityAmortizationOptionsControl value={value} onChange={onChange} />
    </PresentationOptionsProvider>,
  );
  return { ...utils, onChange };
}

describe("LiabilityAmortizationOptionsControl", () => {
  it("ticks every loan when the page prints them all", () => {
    const { getByLabelText } = wrap({ liabilityIds: null });
    expect((getByLabelText(/Mortgage/) as HTMLInputElement).checked).toBe(true);
    expect((getByLabelText(/Car loan/) as HTMLInputElement).checked).toBe(true);
  });

  it("unticking one loan keeps the rest", () => {
    const { getByLabelText, onChange } = wrap({ liabilityIds: null });
    fireEvent.click(getByLabelText(/Mortgage/));
    expect(onChange).toHaveBeenCalledWith({ liabilityIds: ["a"] });
  });

  it("ticking the last loan back returns to all loans", () => {
    const { getByLabelText, onChange } = wrap({ liabilityIds: ["a"] });
    fireEvent.click(getByLabelText(/Mortgage/));
    expect(onChange).toHaveBeenCalledWith({ liabilityIds: null });
  });

  it("asks for a loan when none is ticked", () => {
    const { getByText } = wrap({ liabilityIds: [] });
    expect(getByText("Choose at least one loan.")).toBeTruthy();
  });

  it("says so when the client has no amortizing loans", () => {
    const { getByText } = wrap({ liabilityIds: null }, vi.fn(), []);
    expect(getByText("No amortizing loans on file.")).toBeTruthy();
  });
});
