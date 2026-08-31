// @vitest-environment jsdom
/**
 * The Salary basis panel (Task 4's `SalaryBasisFields`) is mounted by
 * `SavingsRuleDialog` only while a percent-of-salary figure is actually in
 * play — the contribution, the employer match, or both, since both read the
 * same salary number (`salaryByRuleId`, one per rule). It renders LAST in the
 * form (R15): after the End Year picker, not immediately after the employer
 * match block, so a toggle mid-form doesn't shove the year pickers around.
 *
 * `SavingsRuleDialog` saves through `useScenarioWriter().submit`, not a bare
 * `fetch` — the dialog's only direct `fetch` calls are the Schedule
 * sub-resource. So the hook itself is mocked here, with the spy hoisted so
 * the test can reach it (see `savings-rule-dialog-owner-years.test.tsx`,
 * whose inline `submit: vi.fn()` is unreachable from its test bodies).
 *
 * Several tests below build `editing` by running a realistic engine/DB-shaped
 * `SavingsRule` through the REAL `savingsRuleEngineToView` adapter, rather
 * than hand-writing a `SavingsRuleRow` literal. A hand-built fixture can
 * accidentally include fields the adapter actually drops — that is exactly
 * how the round-trip bug (`SavingsRuleView` originally carried neither
 * `salaryBasis` nor `salaryIncomeIds`, so every reopened rule silently reset
 * to "owner" on its next save) escaped this file the first time.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details/income-expenses",
}));

// Untyped `vi.fn()` (not `vi.fn(async () => ...)`) — a zero-arg arrow function
// infers an exact `[]` parameter tuple, and `submit` is called with two
// arguments, which trips `noImplicitAny`-adjacent tuple-index errors on
// `.mock.calls[0][1]` below. `vi.fn()` alone keeps the loose `any[]` args
// vitest defaults to, matching the existing `fetchMock` idiom elsewhere in
// this repo's tests (see `add-roth-conversion-form.test.tsx`).
const submitSpy = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "sr-1" }) })
);
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ scenarioActive: false, submit: submitSpy }),
}));

import SavingsRuleDialog, {
  type SavingsRuleAccount,
  type SavingsRuleRow,
} from "../savings-rule-dialog";
import type { AccountOwner } from "@/engine/ownership";
import type { SalaryOption } from "../salary-basis-fields";
import { buildClientMilestones } from "@/lib/milestones";
import { savingsRuleEngineToView } from "@/lib/scenario/view-adapters";
import type { SavingsRule as EngineSavingsRule } from "@/engine/types";

const NOW = new Date().getFullYear();
const FM_CLIENT = "fm-client";
const FAMILY_MEMBERS = [{ id: FM_CLIENT, role: "client" }];

const MILESTONES = buildClientMilestones(
  {
    dateOfBirth: `${NOW - 50}-03-02`,
    retirementAge: 65,
    planEndAge: 95,
  } as never,
  NOW,
  NOW + 45,
);

// subType "other" (not 401k/403b) supports a percent contribution and an
// employer match without ALSO turning on the Roth/pre-tax split UI — that
// split would add extra required-looking inputs that are beside the point
// of these tests. `acct-cash` supports NEITHER (category "cash"), for the
// "account switch drops match support" regression below.
const ACCOUNTS: SavingsRuleAccount[] = [
  {
    id: "acct-client",
    name: "Harold Retirement",
    category: "retirement",
    subType: "other",
    owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }] as AccountOwner[],
  },
  {
    id: "acct-cash",
    name: "Joint Checking",
    category: "cash",
    subType: "checking",
    owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }] as AccountOwner[],
  },
];

const SALARIES: SalaryOption[] = [
  { id: "inc-1", name: "Base Salary", ownerLabel: "Harold" },
  { id: "inc-2", name: "Base Salary", ownerLabel: "Rhonda" },
];

function renderDialog(
  opts: {
    editing?: SavingsRuleRow;
    onSaved?: (rule: SavingsRuleRow, mode: "create" | "edit") => void;
  } = {}
) {
  render(
    <SavingsRuleDialog
      clientId="c1"
      accounts={ACCOUNTS}
      open
      onOpenChange={() => {}}
      onSaved={opts.onSaved ?? (() => {})}
      editing={opts.editing}
      clientInfo={{ milestones: MILESTONES, planStartYear: NOW, planEndYear: NOW + 45 }}
      ownerNames={{ clientName: "Harold Mueller", spouseName: "Rhonda Mueller" }}
      familyMembers={FAMILY_MEMBERS}
      resolvedInflationRate={0.024}
      salaries={SALARIES}
    />
  );
}

const pickAccount = (id: string) =>
  fireEvent.change(screen.getByLabelText(/^account/i), { target: { value: id } });

describe("SavingsRuleDialog — salary basis", () => {
  beforeEach(() => {
    submitSpy.mockClear();
  });

  it("hides the panel in dollar mode, and again after toggling off percent", async () => {
    // Default state (no `editing`) infers contribMode "amount" and matchMode
    // "none" — neither reads salary, so the panel has nothing to configure.
    renderDialog();
    expect(screen.queryByText(/salary basis/i)).not.toBeInTheDocument();

    // Exercise the UNMOUNT too, not just the initial absence — a panel that
    // never renders and a panel that mounts-then-unmounts on toggle both
    // start out "not present", and only the second proves the condition is
    // reactive rather than one-shot.
    const contribToggles = screen.getByRole("button", { name: /dollar amount/i }).closest("div")!;
    await userEvent.click(within(contribToggles).getByRole("button", { name: /% of salary/i }));
    expect(screen.getByText(/salary basis/i)).toBeInTheDocument();

    await userEvent.click(within(contribToggles).getByRole("button", { name: /dollar amount/i }));
    expect(screen.queryByText(/salary basis/i)).not.toBeInTheDocument();
  });

  it("shows the panel once the contribution is a percent of salary", async () => {
    renderDialog();
    // "Dollar amount" is unique to the contribution toggle set — the sibling
    // "% of salary" button lives in the same `flex gap-1 text-xs` container.
    const contribToggles = screen.getByRole("button", { name: /dollar amount/i }).closest("div")!;
    await userEvent.click(within(contribToggles).getByRole("button", { name: /% of salary/i }));
    expect(screen.getByText(/salary basis/i)).toBeInTheDocument();
  });

  it("shows the panel when only the employer match is a percent", async () => {
    // The match reads the same salary number the contribution does, so a
    // dollar contribution with a percent match still needs the panel.
    renderDialog();
    // "Flat $" is unique to the employer-match toggle set.
    const matchToggles = screen.getByRole("button", { name: /flat \$/i }).closest("div")!;
    await userEvent.click(within(matchToggles).getByRole("button", { name: /% of salary/i }));
    expect(screen.getByText(/salary basis/i)).toBeInTheDocument();
  });

  it("hides the panel again once the account no longer supports an employer match", () => {
    // Production-shaped: a stored percent match, run through the real
    // adapter, on the account that supports it.
    const engineRule: EngineSavingsRule = {
      id: "sr-1",
      accountId: "acct-client",
      annualAmount: 5000,
      isDeductible: false,
      applyContributionLimit: true,
      startYear: NOW,
      endYear: NOW + 10,
      employerMatchPct: 0.5,
      employerMatchCap: 0.06,
      salaryBasis: "owner",
      salaryIncomeIds: [],
    };
    renderDialog({ editing: savingsRuleEngineToView(engineRule) });
    expect(screen.getByText(/salary basis/i)).toBeInTheDocument();

    // `matchMode` state stays "percent" — nothing resets it on an account
    // switch — but `acct-cash` doesn't support a match at all, so the match
    // UI itself disappears. The panel must follow, not linger configuring a
    // number nothing reads anymore.
    pickAccount("acct-cash");

    expect(screen.queryByText(/salary basis/i)).not.toBeInTheDocument();
  });

  it("posts the basis and the ids", async () => {
    renderDialog();
    const contribToggles = screen.getByRole("button", { name: /dollar amount/i }).closest("div")!;
    await userEvent.click(within(contribToggles).getByRole("button", { name: /% of salary/i }));
    await userEvent.type(screen.getByLabelText(/% of salary/i), "10");
    await userEvent.click(screen.getByLabelText(/all salaries/i));
    await userEvent.click(screen.getByRole("button", { name: /add rule/i }));

    await waitFor(() => expect(submitSpy).toHaveBeenCalled());
    // The SECOND arg (`baseFallback`) is the one whose `.body` has the same
    // shape on both the add and edit paths — `submitSpy.mock.calls[0][0]`
    // (the ScenarioEdit) shapes its payload differently per op.
    expect(submitSpy.mock.calls[0][1].body).toMatchObject({
      salaryBasis: "all",
      salaryIncomeIds: [],
    });
  });

  it("keeps a stored basis when the rule is saved in dollar mode", async () => {
    // Production-shaped fixture: dollar-mode contribution, basis "all", run
    // through the real `savingsRuleEngineToView` adapter — not a hand-built
    // `SavingsRuleRow` literal. "all" is deliberately NOT "owner" (the
    // default `useState` would fall back to), so a dropped-field
    // implementation — in the dialog OR in the adapter — reads red here.
    const engineRule: EngineSavingsRule = {
      id: "sr-1",
      accountId: "acct-client",
      annualAmount: 10000,
      isDeductible: false,
      applyContributionLimit: true,
      startYear: NOW,
      endYear: NOW + 10,
      salaryBasis: "all",
      salaryIncomeIds: [],
    };
    renderDialog({ editing: savingsRuleEngineToView(engineRule) });
    expect(screen.queryByText(/salary basis/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(submitSpy).toHaveBeenCalled());
    expect(submitSpy.mock.calls[0][1].body).toMatchObject({ salaryBasis: "all" });
  });

  it("opens showing the exact salaries a stored 'selected' rule was built on", () => {
    // Production-shaped: a raw ENGINE row (percent contribution, basis
    // "selected", one salary id) through the real adapter. If
    // `savingsRuleEngineToView` ever drops `salaryBasis`/`salaryIncomeIds`
    // again, `editing.salaryBasis` reads `undefined`, `inferSalaryBasis`
    // falls back to "owner", and NOTHING below would be checked — this test
    // would go red.
    const engineRule: EngineSavingsRule = {
      id: "sr-1",
      accountId: "acct-client",
      annualAmount: 0,
      annualPercent: 0.06,
      isDeductible: false,
      applyContributionLimit: true,
      startYear: NOW,
      endYear: NOW + 10,
      salaryBasis: "selected",
      salaryIncomeIds: ["inc-1"],
    };
    renderDialog({ editing: savingsRuleEngineToView(engineRule) });

    expect(screen.getByText(/salary basis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/base salary.*harold/i)).toBeChecked();
    expect(screen.getByLabelText(/base salary.*rhonda/i)).not.toBeChecked();
    expect(screen.getByLabelText(/all salaries/i)).not.toBeChecked();
  });

  it("carries the ids forward after saving, even though the server response omits them", async () => {
    // Mirrors the real write path: `salaryBasis` is a column on the
    // `savings_rules` row and round-trips through `res.json()`, but
    // `salaryIncomeIds` lives in a join table the POST/PUT routes never
    // re-query after writing — so the response the dialog actually gets back
    // omits it, even though the DB itself is correct.
    submitSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "sr-1", salaryBasis: "selected" }),
    });
    const onSaved = vi.fn();
    renderDialog({ onSaved });

    const contribToggles = screen.getByRole("button", { name: /dollar amount/i }).closest("div")!;
    await userEvent.click(within(contribToggles).getByRole("button", { name: /% of salary/i }));
    await userEvent.type(screen.getByLabelText(/% of salary/i), "6");
    // One salary, not "All" — lands on basis "selected" with a real id list,
    // the shape the server response can't tell us about.
    await userEvent.click(screen.getByLabelText(/base salary.*harold/i));
    await userEvent.click(screen.getByRole("button", { name: /add rule/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // `onSaved`'s argument is exactly what a caller (income-expenses-view,
    // household-map-view) stores as the row's next `editing` value — if it's
    // missing `salaryIncomeIds`, reopening this SAME rule later in the same
    // session (no page reload) collapses it back to "owner".
    expect(onSaved.mock.calls[0][0]).toMatchObject({ salaryIncomeIds: ["inc-1"] });
  });
});
