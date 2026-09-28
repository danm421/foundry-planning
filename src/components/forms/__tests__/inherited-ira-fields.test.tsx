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
    renderFields({ inherited: false, unavailableReason: "Only an IRA owned by the client or spouse can be marked inherited." });
    const box = screen.getByLabelText("Inherited from someone other than a spouse") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/owned by the client or spouse/)).toBeTruthy();
  });
  it("reports edits", () => {
    const props = renderFields();
    fireEvent.change(screen.getByLabelText("Year of death"), { target: { value: "2023" } });
    expect(props.onDeathYearChange).toHaveBeenCalledWith("2023");
    fireEvent.click(screen.getByLabelText("Heir is disabled or chronically ill"));
    expect(props.onHeirDisabledChange).toHaveBeenCalledWith(true);
  });
});
