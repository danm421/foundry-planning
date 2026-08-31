// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import SalaryBasisFields, {
  inferSalaryBasis,
  type SalaryBasisValue,
} from "../salary-basis-fields";

const SALARIES = [
  { id: "inc-1", name: "Base Salary", ownerLabel: "Jane" },
  { id: "inc-2", name: "Consulting", ownerLabel: "Jane" },
  { id: "inc-3", name: "Base Salary", ownerLabel: "Michael" },
];

function Harness({ initial }: { initial: SalaryBasisValue }) {
  const [value, setValue] = useState(initial);
  return <SalaryBasisFields value={value} onChange={setValue} salaries={SALARIES} />;
}

describe("SalaryBasisFields", () => {
  it("says it falls back to the account owner when nothing is checked", () => {
    render(<Harness initial={{ basis: "owner", incomeIds: [] }} />);
    expect(screen.getByText(/uses the account owner's salary/i)).toBeInTheDocument();
  });

  it("checking All salaries checks and disables every individual box", async () => {
    render(<Harness initial={{ basis: "owner", incomeIds: [] }} />);
    await userEvent.click(screen.getByLabelText(/all salaries/i));
    for (const s of SALARIES) {
      const box = screen.getByLabelText(new RegExp(`${s.name}.*${s.ownerLabel}`, "i"));
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
  });

  it("checking every individual box promotes to All salaries", async () => {
    // Otherwise "all of them" would quietly mean "all of them as of today" and
    // a salary added next month would be left out of a rule the advisor
    // believes covers everything.
    render(<Harness initial={{ basis: "owner", incomeIds: [] }} />);
    for (const s of SALARIES) {
      await userEvent.click(screen.getByLabelText(new RegExp(`${s.name}.*${s.ownerLabel}`, "i")));
    }
    expect(screen.getByLabelText(/all salaries/i)).toBeChecked();
  });

  it("unchecking the last individual box returns to the owner fallback", async () => {
    render(<Harness initial={{ basis: "selected", incomeIds: ["inc-1"] }} />);
    await userEvent.click(screen.getByLabelText(/base salary.*jane/i));
    expect(screen.getByText(/uses the account owner's salary/i)).toBeInTheDocument();
  });

  it("distinguishes two salaries that share a name", () => {
    // "Base Salary" belongs to both people. A list that prints only the income
    // name is unusable for exactly the household this feature is for.
    render(<Harness initial={{ basis: "owner", incomeIds: [] }} />);
    expect(screen.getByLabelText(/base salary.*jane/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/base salary.*michael/i)).toBeInTheDocument();
  });

  it("renders an empty state when the plan has no salaries", () => {
    render(<SalaryBasisFields value={{ basis: "owner", incomeIds: [] }} onChange={() => {}} salaries={[]} />);
    expect(screen.getByText(/no salaries in this plan/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/all salaries/i)).not.toBeInTheDocument();
  });
});

describe("inferSalaryBasis", () => {
  it("reads a stored selected list", () => {
    expect(inferSalaryBasis("selected", ["inc-1"])).toEqual({
      basis: "selected",
      incomeIds: ["inc-1"],
    });
  });

  it("collapses selected-with-no-ids to owner", () => {
    expect(inferSalaryBasis("selected", [])).toEqual({ basis: "owner", incomeIds: [] });
  });

  it("treats a missing basis as owner", () => {
    expect(inferSalaryBasis(null, null)).toEqual({ basis: "owner", incomeIds: [] });
  });
});
