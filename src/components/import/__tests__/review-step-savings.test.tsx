// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewStepSavings from "@/components/import/review-step-savings";

const ROWS = [
  {
    name: "Zach 401(k): Pre-Tax Contribution",
    destinationAccountName: "Zach 401(k)",
    owner: "client" as const,
    annualPercent: 0.1,
    match: { kind: "new" as const },
  },
  {
    name: "Taxable: Annual Contribution",
    destinationAccountName: "Taxable Investment 1",
    owner: "client" as const,
    annualAmount: 12000,
    match: { kind: "new" as const },
  },
];

const OPTIONS = ["Zach 401(k)", "Taxable Investment 1"];

describe("ReviewStepSavings", () => {
  it("shows a percent contribution as a percent", () => {
    render(<ReviewStepSavings rows={ROWS} accountOptions={OPTIONS} onChange={() => {}} />);
    expect(screen.getByText("10% of salary")).toBeInTheDocument();
  });

  it("shows a flat contribution as dollars per year", () => {
    render(<ReviewStepSavings rows={ROWS} accountOptions={OPTIONS} onChange={() => {}} />);
    expect(screen.getByText("$12,000/yr")).toBeInTheDocument();
  });

  it("selects each row's destination account", () => {
    render(<ReviewStepSavings rows={ROWS} accountOptions={OPTIONS} onChange={() => {}} />);
    // Every row renders the same option list, so assert on the selected value
    // of each row's own select rather than on option presence.
    expect((screen.getByTitle("Zach 401(k)") as HTMLSelectElement).value).toBe("Zach 401(k)");
    expect((screen.getByTitle("Taxable Investment 1") as HTMLSelectElement).value).toBe(
      "Taxable Investment 1",
    );
  });

  it("renders an empty state when there is nothing to review", () => {
    render(<ReviewStepSavings rows={[]} accountOptions={OPTIONS} onChange={() => {}} />);
    expect(screen.getByText(/no savings/i)).toBeInTheDocument();
  });

  it("shows a flat-dollar employer contribution", () => {
    render(
      <ReviewStepSavings
        rows={[
          {
            name: "401(k) Employer Match",
            destinationAccountName: "Acme Corp 401(k)",
            owner: "client" as const,
            employerMatchAmount: 4000,
            match: { kind: "new" as const },
          },
        ]}
        accountOptions={["Acme Corp 401(k)"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Employer $4,000/yr")).toBeInTheDocument();
  });

  // The pay-stub case: the extractor proposes "<Employer> 401(k)" and no such
  // account exists, so commitSavings would skip the row. The step has to say so
  // rather than render a destination that looks fine.
  it("flags a destination that matches no account", () => {
    render(
      <ReviewStepSavings
        rows={[
          {
            name: "401(k) Pre-Tax Deferral",
            destinationAccountName: "Acme Corp 401(k)",
            owner: "client" as const,
            annualAmount: 9750,
            match: { kind: "new" as const },
          },
        ]}
        accountOptions={["Zach 401(k)"]}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("option", { name: /Acme Corp 401\(k\) \(no match — will be skipped\)/ }),
    ).toBeInTheDocument();
  });

  // A destination that only resolves after normalization is still valid at
  // commit, so it must not be flagged — and it must stay selected even though
  // it matches no <option> exactly.
  it("keeps a normalization-only destination selected and unflagged", () => {
    render(
      <ReviewStepSavings
        rows={[
          {
            name: "Pre-Tax",
            destinationAccountName: "401k fidelity",
            owner: "client" as const,
            annualPercent: 0.06,
            match: { kind: "new" as const },
          },
        ]}
        accountOptions={["401(k) - Fidelity"]}
        onChange={() => {}}
      />,
    );
    const select = screen.getByTitle("401k fidelity") as HTMLSelectElement;
    expect(select.value).toBe("401k fidelity");
    expect(screen.getByRole("option", { name: "401k fidelity → 401(k) - Fidelity" })).toBeInTheDocument();
    expect(screen.queryByText(/no match/)).not.toBeInTheDocument();
  });

  it("reassigns the destination when the advisor picks another account", async () => {
    const onChange = vi.fn();
    render(
      <ReviewStepSavings
        rows={[
          {
            name: "401(k) Pre-Tax Deferral",
            destinationAccountName: "Acme Corp 401(k)",
            owner: "client" as const,
            annualAmount: 9750,
            match: { kind: "new" as const },
          },
        ]}
        accountOptions={["Zach 401(k)"]}
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByTitle("Acme Corp 401(k)"), "Zach 401(k)");
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ destinationAccountName: "Zach 401(k)" }),
    ]);
  });
});
