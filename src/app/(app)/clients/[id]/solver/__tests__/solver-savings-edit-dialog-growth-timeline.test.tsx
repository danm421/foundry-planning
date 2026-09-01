// @vitest-environment jsdom
/**
 * Two things the Solver's savings editor could not do:
 *   1. Point the ACCOUNT at one of the firm's model portfolios. The only growth
 *      control here used to be the savings rule's own rate — which escalates the
 *      CONTRIBUTION, not the balance — so an advisor reading "Annual growth rate"
 *      was reading the wrong number.
 *   2. Anchor the start/end years to a household milestone, the way every
 *      cash-flow row already can.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, SavingsRule } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { ClientMilestones } from "@/lib/milestones";
import type { SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import { SolverSavingsEditDialog } from "../solver-savings-edit-dialog";

const ACCOUNT = {
  id: "acct-taxable",
  name: "Rachel — Taxable",
  category: "taxable",
  subType: "brokerage",
  growthRate: 0.05,
  growthSource: "default",
  modelPortfolioId: null,
} as unknown as Account;

const BALANCED: SolverModelPortfolio = {
  id: "pf-balanced",
  name: "Balanced 60/40",
  growthRate: 0.062,
  realization: {
    pctOrdinaryIncome: 0.2,
    pctLtCapitalGains: 0.5,
    pctQualifiedDividends: 0.25,
    pctTaxExempt: 0.05,
    turnoverPct: 0,
  },
  mix: [{ assetClassId: "ac-equity", weight: 0.6 }],
};

const MILESTONES: ClientMilestones = {
  planStart: 2026,
  planEnd: 2075,
  clientRetirement: 2044,
  clientEnd: 2060,
};

function rule(over: Partial<SavingsRule> = {}): SavingsRule {
  return {
    id: "sr-1",
    accountId: "acct-taxable",
    annualAmount: 60000,
    startYear: 2026,
    endYear: 2054,
    isDeductible: false,
    ...over,
  } as unknown as SavingsRule;
}

function renderDialog(over: Partial<React.ComponentProps<typeof SolverSavingsEditDialog>> = {}) {
  const onEmit = vi.fn();
  const registerAccountMix = vi.fn();
  render(
    <SolverSavingsEditDialog
      open
      onClose={vi.fn()}
      onEmit={onEmit}
      account={ACCOUNT}
      workingRule={rule()}
      resolvedInflationRate={0.03}
      portfolios={[BALANCED]}
      categoryDefaultRate={0.05}
      registerAccountMix={registerAccountMix}
      milestones={MILESTONES}
      clientFirstName="Rachel"
      {...over}
    />,
  );
  return { onEmit, registerAccountMix };
}

const emitted = (onEmit: ReturnType<typeof vi.fn>): SolverMutation[] =>
  (onEmit.mock.calls[0]?.[0] as SolverMutation[]) ?? [];

describe("SolverSavingsEditDialog — account growth", () => {
  it("offers the firm's portfolios and seeds on the account's current source", () => {
    renderDialog();
    const select = screen.getByLabelText("Grows at") as HTMLSelectElement;
    expect(select.value).toBe("default");
    expect(within(select).getByRole("option", { name: /Balanced 60\/40/ })).toBeTruthy();
  });

  it("moves the account onto the picked portfolio — rate, realization AND basis", async () => {
    const user = userEvent.setup();
    const { onEmit, registerAccountMix } = renderDialog();
    await user.selectOptions(screen.getByLabelText("Grows at"), "pf-balanced");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const upsert = emitted(onEmit).find((m) => m.kind === "account-upsert");
    expect(upsert).toBeDefined();
    const account = (upsert as { value: Account }).value;
    expect(account.growthRate).toBe(0.062);
    expect(account.realization).toEqual(BALANCED.realization);
    // The basis is what makes the pick survive Save-to-base.
    expect(account.growthSource).toBe("model_portfolio");
    expect(account.modelPortfolioId).toBe("pf-balanced");
    // Monte Carlo has to randomize on the allocation, not the flat rate.
    expect(registerAccountMix).toHaveBeenCalledWith("acct-taxable", BALANCED.mix);
  });

  it("stays silent when the growth pick was not touched", async () => {
    const user = userEvent.setup();
    const { onEmit, registerAccountMix } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(emitted(onEmit).some((m) => m.kind === "account-upsert")).toBe(false);
    expect(registerAccountMix).not.toHaveBeenCalled();
  });

  it("shows 'as entered' rather than claiming Plan default for an account on its own mix", () => {
    renderDialog({
      account: { ...ACCOUNT, growthSource: "asset_mix", growthRate: 0.071 } as Account,
    });
    const select = screen.getByLabelText("Grows at") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toContain("as entered");
    expect(select.selectedOptions[0].textContent).toContain("7.10%");
  });

  it("keeps the contribution's own growth as a separate control", () => {
    renderDialog();
    // Both exist and are labelled for what they actually do — the old single
    // "Growth" section was the source of the confusion.
    expect(screen.getByText("Account growth")).toBeTruthy();
    expect(screen.getByText("Contribution growth")).toBeTruthy();
  });
});

describe("SolverSavingsEditDialog — timeline", () => {
  it("offers the household milestones as start/end anchors", () => {
    renderDialog();
    const startMode = screen.getAllByRole("combobox").find((el) =>
      within(el).queryByRole("option", { name: /Rachel Retirement/ }),
    );
    expect(startMode).toBeTruthy();
  });

  it("emits the anchor with the year so the saved rule re-anchors later", async () => {
    const user = userEvent.setup();
    const { onEmit } = renderDialog();
    const startMode = screen
      .getAllByRole("combobox")
      .find((el) => within(el).queryByRole("option", { name: /Rachel Retirement/ }))!;
    await user.selectOptions(startMode, "client_retirement");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const start = emitted(onEmit).find((m) => m.kind === "savings-start-year");
    expect(start).toMatchObject({ year: 2044, ref: "client_retirement" });
  });

  it("clears the anchor when the advisor switches back to a typed year", async () => {
    const user = userEvent.setup();
    const { onEmit } = renderDialog({
      workingRule: rule({ startYearRef: "client_retirement", startYear: 2044 }),
    });
    const startMode = screen
      .getAllByRole("combobox")
      .find((el) => within(el).queryByRole("option", { name: /Rachel Retirement/ }))!;
    await user.selectOptions(startMode, "manual");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    // Same year, but no longer anchored — the mutation must carry the null or
    // the stored rule silently re-anchors on the next load.
    const start = emitted(onEmit).find((m) => m.kind === "savings-start-year");
    expect(start).toMatchObject({ year: 2044, ref: null });
  });

  it("falls back to plain year inputs when no milestones are supplied", () => {
    renderDialog({ milestones: undefined });
    expect(screen.getByText("Start year")).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: /Rachel Retirement/ }),
    ).toBeNull();
  });
});
