// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AgeYearField } from "../age-year-field";

function setup(birthYear: number | null) {
  render(
    <AgeYearField
      name="retirementAge"
      label="Retirement Age"
      required
      defaultAge={65}
      min={40}
      max={85}
      birthYear={birthYear}
    />,
  );
  const ageInput = screen.getByLabelText("Retirement Age (age)") as HTMLInputElement;
  const yearInput = screen.getByLabelText("Retirement Age (calendar year)") as HTMLInputElement;
  return { ageInput, yearInput };
}

describe("AgeYearField", () => {
  it("derives the year from the seeded age and birth year", () => {
    const { ageInput, yearInput } = setup(1980);
    expect(ageInput.value).toBe("65");
    expect(yearInput.value).toBe("2045");
  });

  it("submits the age under the field name (year input is unnamed)", () => {
    const { ageInput, yearInput } = setup(1980);
    expect(ageInput.name).toBe("retirementAge");
    expect(yearInput.name).toBe("");
  });

  it("updates the year when the age changes", () => {
    const { ageInput, yearInput } = setup(1980);
    fireEvent.change(ageInput, { target: { value: "70" } });
    expect(yearInput.value).toBe("2050");
  });

  it("back-solves the age when a full year is typed", () => {
    const { ageInput, yearInput } = setup(1980);
    fireEvent.change(yearInput, { target: { value: "2040" } });
    expect(ageInput.value).toBe("60");
  });

  it("clamps a back-solved age to the field bounds", () => {
    const { ageInput, yearInput } = setup(1980);
    // 1980 + age = 2100 → age 120, clamps to max 85
    fireEvent.change(yearInput, { target: { value: "2100" } });
    expect(ageInput.value).toBe("85");
  });

  it("disables the year and shows only the age when birth year is unknown", () => {
    const { ageInput, yearInput } = setup(null);
    expect(ageInput.value).toBe("65");
    expect(yearInput.disabled).toBe(true);
    expect(yearInput.value).toBe("");
  });
});
