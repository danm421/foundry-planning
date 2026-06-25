// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
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

  it("still calls onChange when the date of birth changes (autosave wiring intact)", () => {
    const onChange = vi.fn();
    render(<FamilyStep {...makeProps({ onChange })} />);

    const dob = screen.getByLabelText(/date of birth/i);
    fireEvent.change(dob, { target: { value: "1980-12-31" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: FamilySlice = onChange.mock.calls[0][0];
    expect(next?.primary?.dateOfBirth).toBe("1980-12-31");
  });

  it("date of birth is uncontrolled so React never clobbers an in-progress native segment edit", () => {
    // Native <input type="date"> edits segment-by-segment (MM→DD→YYYY) and
    // auto-advances as the user types. It also emits a change event for any
    // momentarily-valid date — e.g. year 0001 while the user is mid-way through
    // typing 1985. If the input were *controlled*, each of those events would
    // re-render and rewrite .value into the DOM input mid-edit, resetting the
    // segment selection and breaking auto-advance. Keeping it uncontrolled
    // (defaultValue) means a new value prop must NOT overwrite the DOM value
    // while the field is mounted/being edited.
    const { rerender } = render(<FamilyStep value={baseValue} onChange={vi.fn()} />);
    const dob = screen.getByLabelText(/date of birth/i) as HTMLInputElement;
    expect(dob.value).toBe("1975-06-15");

    rerender(
      <FamilyStep
        value={{ ...baseValue, primary: { ...basePrimary, dateOfBirth: "2000-01-01" } }}
        onChange={vi.fn()}
      />,
    );

    expect(dob.value).toBe("1975-06-15");
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

  it("removing a non-last child remounts remaining cards so uncontrolled DOBs aren't stale", () => {
    // Children DOB inputs are uncontrolled (defaultValue). With index keys, removing
    // the first child would reuse the removed card's DOM node and the surviving
    // child's date input would show the wrong (removed) value. Stable keys remount.
    function Harness() {
      const [value, setValue] = useState<FamilySlice>({
        primary: { firstName: "Jane", dateOfBirth: "1975-06-15" },
        children: [
          { firstName: "Alice", dateOfBirth: "2010-03-22" },
          { firstName: "Bob", dateOfBirth: "2013-07-04" },
        ],
      });
      return <FamilyStep value={value} onChange={setValue} />;
    }

    render(<Harness />);
    const [firstRemove] = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(firstRemove);

    const dobs = screen.getAllByLabelText(/date of birth/i) as HTMLInputElement[];
    // primary + the one surviving child (Bob)
    expect(dobs[dobs.length - 1].value).toBe("2013-07-04");
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
