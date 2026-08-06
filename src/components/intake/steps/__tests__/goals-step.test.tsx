// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { isBlankIntakeExpenseGoalRow, type IntakeDraft } from "@/lib/intake/schema";
import { GoalsStep, type GoalBeneficiary } from "../goals-step";

type GoalsSlice = IntakeDraft["goals"];

type GoalItem = NonNullable<NonNullable<GoalsSlice>["expenseGoals"]>[number];

function makeProps(
  overrides: Partial<{
    value: GoalsSlice;
    onChange: (v: GoalsSlice) => void;
    beneficiaries: GoalBeneficiary[];
  }> = {},
) {
  return {
    value: {} as GoalsSlice,
    onChange: vi.fn(),
    ...overrides,
  };
}

/** Open the one goal card whose collapsed row carries `name`. */
function expandGoal(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

const COLLEGE: GoalItem = {
  name: "Emma's college",
  type: "education",
  amount: 40000,
  startYear: 2034,
  years: 4,
};

describe("GoalsStep", () => {
  it("renders the retirement-age spinbuttons and the money expenses field", () => {
    render(<GoalsStep {...makeProps()} />);

    expect(screen.getByRole("spinbutton", { name: /client.*retirement age/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /spouse.*retirement age/i })).toBeInTheDocument();
    // annual expenses is now a formatted money field (text input)
    expect(screen.getByRole("textbox", { name: /annual retirement expenses/i })).toBeInTheDocument();
  });

  it("renders existing values in the inputs", () => {
    const value: GoalsSlice = {
      clientRetirementAge: 65,
      spouseRetirementAge: 63,
      annualRetirementExpenses: 80000,
    };
    render(<GoalsStep {...makeProps({ value })} />);

    expect((screen.getByRole("spinbutton", { name: /client.*retirement age/i }) as HTMLInputElement).value).toBe("65");
    expect((screen.getByRole("spinbutton", { name: /spouse.*retirement age/i }) as HTMLInputElement).value).toBe("63");
    // expenses formats with separators: 80000 → "80,000"
    expect((screen.getByRole("textbox", { name: /annual retirement expenses/i }) as HTMLInputElement).value).toBe("80,000");
  });

  it("changing clientRetirementAge calls onChange with updated numeric value", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /client.*retirement age/i }), {
      target: { value: "67" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.clientRetirementAge).toBe(67);
  });

  it("changing spouseRetirementAge calls onChange with updated numeric value", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /spouse.*retirement age/i }), {
      target: { value: "62" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.spouseRetirementAge).toBe(62);
  });

  it("changing annualRetirementExpenses calls onChange with updated numeric value", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.change(screen.getByRole("textbox", { name: /annual retirement expenses/i }), {
      target: { value: "90000" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.annualRetirementExpenses).toBe(90000);
  });

  it("clearing a field calls onChange with undefined for that field", () => {
    const onChange = vi.fn();
    const value: GoalsSlice = { clientRetirementAge: 65 };
    render(<GoalsStep {...makeProps({ value, onChange })} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /client.*retirement age/i }), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.clientRetirementAge).toBeUndefined();
  });
});

describe("GoalsStep — upcoming goals", () => {
  it("adds a blank goal that the prune predicate treats as untouched", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));

    const added = onChange.mock.calls[0][0]?.expenseGoals;
    expect(added).toHaveLength(1);
    // The template must stay prunable, or an abandoned card fails strict submit.
    expect(isBlankIntakeExpenseGoalRow(added![0])).toBe(true);
  });

  it("collapses a goal to a row carrying its type, beneficiary, and span", () => {
    render(
      <GoalsStep
        {...makeProps({
          value: { expenseGoals: [{ ...COLLEGE, forWhom: "child:0" }] },
          beneficiaries: [{ ref: "child:0", name: "Emma" }],
        })}
      />,
    );

    // The stored ref resolves back to a name for display; 2034 + 4 years, both
    // ends inclusive → 2034–2037.
    expect(screen.getByText(/Education · Emma · 2034–2037/)).toBeInTheDocument();
  });

  it("totals cost across every funded year, not just one", () => {
    render(<GoalsStep {...makeProps({ value: { expenseGoals: [COLLEGE] } })} />);

    // $40,000 × 4 years — a per-year-only total would read $40,000.
    expect(screen.getByText("$160,000")).toBeInTheDocument();
  });

  it("edits a goal's cost through the expanded card", () => {
    const onChange = vi.fn();
    render(
      <GoalsStep {...makeProps({ value: { expenseGoals: [COLLEGE] }, onChange })} />,
    );
    expandGoal(/edit emma's college/i);

    fireEvent.change(screen.getByRole("textbox", { name: /estimated cost/i }), {
      target: { value: "52000" },
    });

    expect(onChange.mock.calls[0][0]?.expenseGoals?.[0].amount).toBe(52000);
  });

  it("rejects a fractional duration rather than letting it reach strict submit", () => {
    const onChange = vi.fn();
    render(
      <GoalsStep {...makeProps({ value: { expenseGoals: [COLLEGE] }, onChange })} />,
    );
    expandGoal(/edit emma's college/i);

    fireEvent.change(screen.getByRole("textbox", { name: /for how long/i }), {
      target: { value: "2.5" },
    });

    // `years` is z.number().int() on submit — the field must strip the ".".
    expect(onChange.mock.calls[0][0]?.expenseGoals?.[0].years).toBe(25);
  });

  it("keeps the beneficiary selected after the client renames them", () => {
    // The whole point of storing a ref rather than a name: the client can go
    // back to Family, fix a spelling, and the goal still points at that child.
    render(
      <GoalsStep
        {...makeProps({
          value: { expenseGoals: [{ ...COLLEGE, forWhom: "child:0" }] },
          beneficiaries: [{ ref: "child:0", name: "Em" }],
        })}
      />,
    );
    expandGoal(/edit emma's college/i);

    const picker = screen.getByRole("combobox", { name: /who is this for/i });
    expect((picker as HTMLSelectElement).value).toBe("child:0");
    expect(screen.getByRole("option", { name: "Em" })).toBeInTheDocument();
  });

  it("hides the beneficiary picker when the family named no one", () => {
    render(<GoalsStep {...makeProps({ value: { expenseGoals: [COLLEGE] } })} />);
    expandGoal(/edit emma's college/i);

    expect(screen.queryByRole("combobox", { name: /who is this for/i })).toBeNull();
  });

  it("dates an education goal from the student's 16th birthday when the type is picked", () => {
    const onChange = vi.fn();
    const forEmma: GoalItem = {
      name: "College",
      type: "other",
      amount: 0,
      years: 1,
      forWhom: "child:0",
    };
    render(
      <GoalsStep
        {...makeProps({
          value: { expenseGoals: [forEmma] },
          onChange,
          beneficiaries: [{ ref: "child:0", name: "Emma", dateOfBirth: "2014-03-02" }],
        })}
      />,
    );
    expandGoal(/edit college/i);

    fireEvent.change(screen.getByRole("combobox", { name: /goal type/i }), {
      target: { value: "education" },
    });

    const goal = onChange.mock.calls[0][0]?.expenseGoals?.[0];
    // educationGoalYears: born 2014 → funding starts at 16, four years long.
    expect(goal?.startYear).toBe(2030);
    expect(goal?.years).toBe(4);
  });

  it("dates it the other way round too — type first, then the student", () => {
    const onChange = vi.fn();
    const undated: GoalItem = { name: "College", type: "education", amount: 0, years: 4 };
    render(
      <GoalsStep
        {...makeProps({
          value: { expenseGoals: [undated] },
          onChange,
          beneficiaries: [{ ref: "child:0", name: "Emma", dateOfBirth: "2014-03-02" }],
        })}
      />,
    );
    expandGoal(/edit college/i);

    fireEvent.change(screen.getByRole("combobox", { name: /who is this for/i }), {
      target: { value: "child:0" },
    });

    expect(onChange.mock.calls[0][0]?.expenseGoals?.[0].startYear).toBe(2030);
  });

  it("leaves the year alone for a beneficiary with no date of birth", () => {
    const onChange = vi.fn();
    const undated: GoalItem = { name: "College", type: "education", amount: 0, years: 4 };
    render(
      <GoalsStep
        {...makeProps({
          value: { expenseGoals: [undated] },
          onChange,
          beneficiaries: [{ ref: "child:0", name: "Emma" }],
        })}
      />,
    );
    expandGoal(/edit college/i);

    fireEvent.change(screen.getByRole("combobox", { name: /who is this for/i }), {
      target: { value: "child:0" },
    });

    const goal = onChange.mock.calls[0][0]?.expenseGoals?.[0];
    // The REF is what's stored, never the name.
    expect(goal?.forWhom).toBe("child:0");
    expect(goal?.startYear).toBeUndefined();
  });

  it("never overwrites a start year the client already typed", () => {
    const onChange = vi.fn();
    const dated: GoalItem = {
      name: "College",
      type: "other",
      amount: 0,
      years: 1,
      startYear: 2028,
      forWhom: "child:0",
    };
    render(
      <GoalsStep
        {...makeProps({
          value: { expenseGoals: [dated] },
          onChange,
          beneficiaries: [{ ref: "child:0", name: "Emma", dateOfBirth: "2014-03-02" }],
        })}
      />,
    );
    expandGoal(/edit college/i);

    fireEvent.change(screen.getByRole("combobox", { name: /goal type/i }), {
      target: { value: "education" },
    });

    expect(onChange.mock.calls[0][0]?.expenseGoals?.[0].startYear).toBe(2028);
  });
});

describe("GoalsStep — on your radar", () => {
  it("checking a topic adds it to the list", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /charitable giving/i }));

    expect(onChange.mock.calls[0][0]?.topics).toEqual(["charitable"]);
  });

  it("unchecking a topic removes only that one", () => {
    const onChange = vi.fn();
    render(
      <GoalsStep {...makeProps({ value: { topics: ["charitable", "legacy"] }, onChange })} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /charitable giving/i }));

    expect(onChange.mock.calls[0][0]?.topics).toEqual(["legacy"]);
  });

  it("reflects already-checked topics", () => {
    render(<GoalsStep {...makeProps({ value: { topics: ["debt"] } })} />);

    expect(screen.getByRole("checkbox", { name: /paying off debt/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /a wedding/i })).not.toBeChecked();
  });

  it("captures the free-text note", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.change(screen.getByRole("textbox", { name: /anything else on your mind/i }), {
      target: { value: "Thinking about a cabin." },
    });

    expect(onChange.mock.calls[0][0]?.topicsNote).toBe("Thinking about a cabin.");
  });
});
