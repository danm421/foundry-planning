// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverQuickAddAccount } from "../solver-quick-add-account";

const owners = [{ familyMemberId: "fm-1", label: "John" }];

describe("SolverQuickAddAccount", () => {
  it("emits account-upsert + savings-rule-upsert on submit", () => {
    const onChange = vi.fn();
    render(
      <SolverQuickAddAccount
        owners={owners}
        currentYear={2026}
        retirementYearForOwner={() => 2045}
        growthForType={() => 0.06}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    fireEvent.change(screen.getByLabelText(/annual savings/i), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    const kinds = onChange.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain("account-upsert");
    expect(kinds).toContain("savings-rule-upsert");
    const rule = onChange.mock.calls.map((c) => c[0]).find((m) => m.kind === "savings-rule-upsert");
    expect(rule.value.annualAmount).toBe(12000);
    expect(rule.value.startYear).toBe(2026);
    expect(rule.value.endYear).toBe(2045);
  });

  it("auto-composes name from owner + type and leaves it editable", () => {
    render(
      <SolverQuickAddAccount
        owners={owners} currentYear={2026} retirementYearForOwner={() => 2045}
        growthForType={() => 0.06} onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe("John — Taxable");
  });
});
