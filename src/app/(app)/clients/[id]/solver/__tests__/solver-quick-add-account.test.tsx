// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverQuickAddAccount } from "../solver-quick-add-account";
import type { ClientMilestones } from "@/lib/milestones";

const owners = [{ familyMemberId: "fm-1", label: "John" }];

const existingAccounts = [
  { id: "acct-brokerage", name: "Joint Brokerage", category: "taxable", subType: "brokerage", ownerFamilyMemberId: "fm-1" },
  { id: "acct-401k", name: "John 401(k)", category: "retirement", subType: "401k", ownerFamilyMemberId: "fm-1" },
];

const milestones: ClientMilestones = {
  planStart: 2026, planEnd: 2061, clientRetirement: 2045, clientEnd: 2061,
};

const BALANCED = {
  id: "pf-balanced",
  name: "Balanced 60/40",
  growthRate: 0.062,
  realization: {
    pctOrdinaryIncome: 0.2, pctLtCapitalGains: 0.5,
    pctQualifiedDividends: 0.25, pctTaxExempt: 0.05, turnoverPct: 0,
  },
  mix: [{ assetClassId: "ac-equity", weight: 0.6 }],
};

let registerAccountMix: ReturnType<typeof vi.fn<(accountId: string, mix: unknown[]) => void>>;

function renderForm(props: Partial<React.ComponentProps<typeof SolverQuickAddAccount>> = {}) {
  const onChange = vi.fn();
  registerAccountMix = vi.fn<(accountId: string, mix: unknown[]) => void>();
  render(
    <SolverQuickAddAccount
      owners={owners}
      existingAccounts={props.existingAccounts ?? existingAccounts}
      currentYear={2026}
      retirementYearForOwner={() => 2045}
      growthForType={() => 0.06}
      milestones={milestones}
      portfolios={props.portfolios ?? [BALANCED]}
      registerAccountMix={registerAccountMix}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("SolverQuickAddAccount", () => {
  it("adds savings to an existing account with a single savings-rule-upsert (no account-upsert)", () => {
    const onChange = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    // existing account is the default selection (first in list)
    fireEvent.change(screen.getByLabelText(/annual savings/i), { target: { value: "8000" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    const kinds = onChange.mock.calls.map((c) => c[0].kind);
    expect(kinds).toEqual(["savings-rule-upsert"]);
    const rule = onChange.mock.calls[0][0];
    expect(rule.value.accountId).toBe("acct-brokerage");
    expect(rule.value.annualAmount).toBe(8000);
    expect(rule.value.isDeductible).toBe(false);
    expect(rule.value.startYear).toBe(2026);
    expect(rule.value.endYear).toBe(2045);
  });

  it("derives deductible + pre-tax for an existing 401(k)", () => {
    const onChange = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    fireEvent.change(screen.getByLabelText(/^account$/i), { target: { value: "acct-401k" } });
    fireEvent.change(screen.getByLabelText(/annual savings/i), { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    const rule = onChange.mock.calls[0][0];
    expect(rule.kind).toBe("savings-rule-upsert");
    expect(rule.value.accountId).toBe("acct-401k");
    expect(rule.value.isDeductible).toBe(true);
    expect(rule.value.rothPercent).toBeUndefined();
  });

  it("hides Type/Owner/Name when an existing account is selected", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    expect(screen.queryByLabelText(/^type$/i)).toBeNull();
    expect(screen.queryByLabelText(/^owner$/i)).toBeNull();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
  });

  it("reveals Type/Owner/Name and emits both mutations in new-account mode", () => {
    const onChange = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    fireEvent.change(screen.getByLabelText(/^account$/i), { target: { value: "__new__" } });
    expect(screen.getByLabelText(/^type$/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/annual savings/i), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    const kinds = onChange.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain("account-upsert");
    expect(kinds).toContain("savings-rule-upsert");
  });

  it("falls back to new-account mode when no existing accounts are eligible", () => {
    renderForm({ existingAccounts: [] });
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    expect(screen.getByLabelText(/^type$/i)).toBeTruthy();
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe("John — Taxable");
  });
});

describe("SolverQuickAddAccount — growth basis", () => {
  function addNewAccountWith(growsAt?: string) {
    const onChange = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    fireEvent.change(screen.getByLabelText(/^account$/i), { target: { value: "__new__" } });
    if (growsAt) {
      fireEvent.change(screen.getByLabelText(/grows at/i), { target: { value: growsAt } });
    }
    fireEvent.change(screen.getByLabelText(/annual savings/i), { target: { value: "60000" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    return onChange.mock.calls.map((c) => c[0]);
  }

  it("offers the firm's model portfolios alongside the plan default", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    fireEvent.change(screen.getByLabelText(/^account$/i), { target: { value: "__new__" } });
    const select = screen.getByLabelText(/grows at/i) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(["6.00% — Plan default", "6.20% — Balanced 60/40"]);
  });

  it("mints the account on the picked portfolio and registers its MC mix", () => {
    const calls = addNewAccountWith("pf-balanced");
    const account = calls.find((m) => m.kind === "account-upsert")!.value;
    expect(account.growthRate).toBe(0.062);
    expect(account.realization).toEqual(BALANCED.realization);
    // Basis, not just the number: without it the saved account re-derives its
    // growth from the category default on the next load.
    expect(account.growthSource).toBe("model_portfolio");
    expect(account.modelPortfolioId).toBe("pf-balanced");
    expect(registerAccountMix).toHaveBeenCalledWith(account.id, BALANCED.mix);
  });

  it("defaults to the plan's category rate and links no portfolio", () => {
    const calls = addNewAccountWith();
    const account = calls.find((m) => m.kind === "account-upsert")!.value;
    expect(account.growthRate).toBe(0.06);
    expect(account.growthSource).toBe("default");
    expect(account.modelPortfolioId).toBeNull();
    // Registered with an EMPTY mix, which the workspace reads as "clear any
    // stored allocation" — a deterministic source must not leave a stale
    // allocation randomizing this account in Monte Carlo.
    expect(registerAccountMix).toHaveBeenCalledWith(account.id, []);
  });
});
