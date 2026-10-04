// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InheritedIraFields, type InheritedIraFieldsProps } from "../inherited-ira-fields";

function renderFields(over: Partial<InheritedIraFieldsProps> = {}) {
  const props: InheritedIraFieldsProps = {
    isRoth: false,
    inherited: true, onInheritedChange: vi.fn(),
    deathYear: "2022", onDeathYearChange: vi.fn(),
    ownerBirthYear: "1945", onOwnerBirthYearChange: vi.fn(),
    heirDisabled: false, onHeirDisabledChange: vi.fn(),
    heirBirthYear: 1975, referenceYear: 2026,
    unavailableReason: null, error: null,
    payoutPlan: "minimum", onPayoutPlanChange: vi.fn(),
    payoutFromYear: "", onPayoutFromYearChange: vi.fn(),
    payoutThroughYear: "", onPayoutThroughYearChange: vi.fn(),
    payoutError: null,
    ...over,
  };
  render(<InheritedIraFields {...props} />);
  return props;
}

describe("InheritedIraFields", () => {
  it("shows the age hint and the rule summary", () => {
    renderFields();
    expect(screen.getByText("Age 77 at death · had started RMDs")).toBeTruthy();
    expect(screen.getByTestId("inherited-rule-summary").textContent).toContain("Dec 31, 2032");
  });
  it("prompts for a date of birth when the heir's birth year is unknown", () => {
    renderFields({ heirBirthYear: null });
    expect(screen.getByTestId("inherited-rule-summary").textContent).toContain("Add the heir's date of birth");
  });
  it("offers the disability checkbox only for deaths in 2020 or later", () => {
    renderFields({ deathYear: "2015", ownerBirthYear: "1940" });
    expect(screen.queryByLabelText("Heir is disabled or chronically ill")).toBeNull();
  });
  it("shows the validation error instead of the hint", () => {
    renderFields({ error: "The year of death can't be later than 2026." });
    expect(screen.getByRole("alert").textContent).toContain("later than 2026");
    expect(screen.queryByTestId("inherited-rule-summary")).toBeNull();
  });
  it("disables an unticked checkbox with the reason when the IRA isn't the client's or spouse's", () => {
    renderFields({ inherited: false, unavailableReason: "Only an IRA owned by the client or co-client can be marked inherited." });
    const box = screen.getByLabelText("Inherited from someone other than a spouse") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/owned by the client or co-client/)).toBeTruthy();
  });
  it("reports edits", () => {
    const props = renderFields();
    fireEvent.change(screen.getByLabelText("Year of death"), { target: { value: "2023" } });
    expect(props.onDeathYearChange).toHaveBeenCalledWith("2023");
    fireEvent.click(screen.getByLabelText("Heir is disabled or chronically ill"));
    expect(props.onHeirDisabledChange).toHaveBeenCalledWith(true);
  });
  // Default fixture: death 2022, owner born 1945, heir born 1975 → 10-year rule, deadline 2032.
  it("offers the payout plan, defaulting to the minimum with the deadline named", () => {
    renderFields();
    expect((screen.getByLabelText("Minimum each year") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("The rest comes out in 2032.")).toBeTruthy();
    expect(screen.queryByLabelText("From")).toBeNull();
  });
  it("names life expectancy on a stretch account", () => {
    renderFields({ deathYear: "2015", ownerBirthYear: "1940" });
    expect(screen.getByText("Over the heir's life expectancy.")).toBeTruthy();
  });
  it("choosing 'Spread payouts evenly' pre-fills the first year and the deadline", () => {
    const props = renderFields();
    fireEvent.click(screen.getByLabelText("Spread payouts evenly"));
    expect(props.onPayoutPlanChange).toHaveBeenCalledWith("even");
    expect(props.onPayoutFromYearChange).toHaveBeenCalledWith("2026");
    expect(props.onPayoutThroughYearChange).toHaveBeenCalledWith("2032");
  });
  it("does not overwrite years already typed", () => {
    const props = renderFields({ payoutFromYear: "2028", payoutThroughYear: "2030" });
    fireEvent.click(screen.getByLabelText("Spread payouts evenly"));
    expect(props.onPayoutFromYearChange).not.toHaveBeenCalled();
    expect(props.onPayoutThroughYearChange).not.toHaveBeenCalled();
  });
  it("shows the window inputs and the preview line", () => {
    renderFields({ payoutPlan: "even", payoutFromYear: "2028", payoutThroughYear: "2032" });
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2028");
    expect((screen.getByLabelText("Through") as HTMLInputElement).value).toBe("2032");
    expect(screen.getByTestId("inherited-payout-preview").textContent).toBe(
      "Each year from 2028 through 2032 pays the larger of the minimum and an even share of what's left. The account is empty after 2032.",
    );
  });
  it("shows the window error in place of the preview", () => {
    renderFields({
      payoutPlan: "even", payoutFromYear: "2028", payoutThroughYear: "2035",
      payoutError: "The 10-year rule empties this account by 2032, so the last payout year can't be later.",
    });
    expect(screen.getByRole("alert").textContent).toContain("empties this account by 2032");
    expect(screen.queryByTestId("inherited-payout-preview")).toBeNull();
  });
  it("still offers the payout plan when the heir's birth year is unknown", () => {
    const props = renderFields({ heirBirthYear: null });
    expect(screen.getByLabelText("Minimum each year")).toBeTruthy();
    expect(screen.queryByText(/The rest comes out/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Spread payouts evenly"));
    expect(props.onPayoutFromYearChange).toHaveBeenCalledWith("2026");
    expect(props.onPayoutThroughYearChange).not.toHaveBeenCalled();
  });
  it("reports window edits", () => {
    const props = renderFields({ payoutPlan: "even", payoutFromYear: "2028", payoutThroughYear: "2032" });
    fireEvent.change(screen.getByLabelText("Through"), { target: { value: "2031" } });
    expect(props.onPayoutThroughYearChange).toHaveBeenCalledWith("2031");
  });
});
