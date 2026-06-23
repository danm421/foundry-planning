// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { FamilyStep } from "../family-step";

type FamilySlice = IntakeDraft["family"];

const basePrimary: NonNullable<NonNullable<FamilySlice>["primary"]> = {
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "1975-06-15",
  maritalStatus: "married",
};

const baseValue: FamilySlice = {
  primary: basePrimary,
  spouse: undefined,
  stateOfResidence: undefined,
  children: [],
};

function makeProps(overrides: Partial<{ value: FamilySlice; onChange: (v: FamilySlice) => void }> = {}) {
  return {
    value: baseValue,
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("FamilyStep", () => {
  it("renders primary person fields with existing values", () => {
    render(<FamilyStep {...makeProps()} />);

    const firstNameInput = screen.getByRole("textbox", { name: /first name/i });
    expect(firstNameInput).toBeInTheDocument();
    // Should be scoped to the primary section — use getAllByRole if needed
    expect((firstNameInput as HTMLInputElement).value).toBe("Jane");
  });

  it("calls onChange with updated primary.firstName when user types", () => {
    const onChange = vi.fn();
    render(<FamilyStep {...makeProps({ onChange })} />);

    // Get all "First name" inputs — first one is primary
    const [primaryFirstName] = screen.getAllByRole("textbox", { name: /first name/i });
    fireEvent.change(primaryFirstName, { target: { value: "Janet" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.primary?.firstName).toBe("Janet");
  });

  it("calls onChange with updated primary.lastName when user types", () => {
    const onChange = vi.fn();
    render(<FamilyStep {...makeProps({ onChange })} />);

    const [primaryLastName] = screen.getAllByRole("textbox", { name: /last name/i });
    fireEvent.change(primaryLastName, { target: { value: "Smith" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.primary?.lastName).toBe("Smith");
  });

  it("calls onChange with updated primary.maritalStatus when changed", () => {
    const onChange = vi.fn();
    render(<FamilyStep {...makeProps({ onChange })} />);

    const maritalSelect = screen.getByRole("combobox", { name: /marital status/i });
    fireEvent.change(maritalSelect, { target: { value: "divorced" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.primary?.maritalStatus).toBe("divorced");
  });

  it("calls onChange with updated stateOfResidence when state select changes", () => {
    const onChange = vi.fn();
    render(<FamilyStep {...makeProps({ onChange })} />);

    const stateSelect = screen.getByRole("combobox", { name: /state of residence/i });
    fireEvent.change(stateSelect, { target: { value: "CA" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.stateOfResidence).toBe("CA");
  });

  it("clicking Add Child appends a child card and calls onChange with a new child", () => {
    const onChange = vi.fn();
    render(<FamilyStep {...makeProps({ onChange })} />);

    const addChildBtn = screen.getByRole("button", { name: /add child/i });
    fireEvent.click(addChildBtn);

    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.children).toHaveLength(1);
    expect(next?.children?.[0]).toMatchObject({ firstName: "", dateOfBirth: "" });
  });

  it("renders existing children and shows remove button for each", () => {
    const valueWithChildren: FamilySlice = {
      ...baseValue,
      children: [
        { firstName: "Alice", lastName: "Doe", dateOfBirth: "2010-03-22" },
        { firstName: "Bob", dateOfBirth: "2013-07-04" },
      ],
    };
    render(<FamilyStep value={valueWithChildren} onChange={vi.fn()} />);

    // Both children visible
    const firstNameInputs = screen.getAllByRole("textbox", { name: /first name/i });
    // primary + possibly spouse + 2 children
    const aliceInput = firstNameInputs.find(
      (el) => (el as HTMLInputElement).value === "Alice"
    );
    const bobInput = firstNameInputs.find(
      (el) => (el as HTMLInputElement).value === "Bob"
    );
    expect(aliceInput).toBeInTheDocument();
    expect(bobInput).toBeInTheDocument();

    // Remove buttons present for each child
    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    expect(removeButtons).toHaveLength(2);
  });

  it("clicking Remove child calls onChange without that child", () => {
    const onChange = vi.fn();
    const valueWithChildren: FamilySlice = {
      ...baseValue,
      children: [
        { firstName: "Alice", lastName: "Doe", dateOfBirth: "2010-03-22" },
        { firstName: "Bob", dateOfBirth: "2013-07-04" },
      ],
    };
    render(<FamilyStep value={valueWithChildren} onChange={onChange} />);

    const [firstRemove] = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(firstRemove);

    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.children).toHaveLength(1);
    expect(next?.children?.[0]?.firstName).toBe("Bob");
  });

  it("toggling Add Spouse calls onChange with a spouse entry", () => {
    const onChange = vi.fn();
    render(<FamilyStep {...makeProps({ onChange })} />);

    const addSpouseBtn = screen.getByRole("button", { name: /add spouse/i });
    fireEvent.click(addSpouseBtn);

    // onChange should have been called with a spouse object initialised
    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.spouse).toBeDefined();
    expect(next?.spouse?.firstName).toBe("");
  });

  it("when value includes a spouse, spouse fields are visible", () => {
    const valueWithSpouse: FamilySlice = {
      ...baseValue,
      spouse: { firstName: "John", lastName: "Doe", dateOfBirth: "1973-09-10", maritalStatus: "married" },
    };
    render(<FamilyStep value={valueWithSpouse} onChange={vi.fn()} />);

    // Both primary and spouse first name inputs visible
    const firstNameInputs = screen.getAllByRole("textbox", { name: /first name/i });
    expect(firstNameInputs.length).toBeGreaterThanOrEqual(2);
  });

  it("editing spouse first name calls onChange with updated spouse.firstName", () => {
    const onChange = vi.fn();
    const valueWithSpouse: FamilySlice = {
      ...baseValue,
      spouse: { firstName: "John", lastName: "Doe", dateOfBirth: "1973-09-10", maritalStatus: "married" },
    };
    render(<FamilyStep value={valueWithSpouse} onChange={onChange} />);

    // Second "First name" input is the spouse's
    const [, spouseFirstName] = screen.getAllByRole("textbox", { name: /first name/i });
    fireEvent.change(spouseFirstName, { target: { value: "Jonathan" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.spouse?.firstName).toBe("Jonathan");
  });
});
