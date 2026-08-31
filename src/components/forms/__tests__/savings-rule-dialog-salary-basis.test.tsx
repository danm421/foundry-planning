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
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
// of these tests.
const ACCOUNTS: SavingsRuleAccount[] = [
  {
    id: "acct-client",
    name: "Harold Retirement",
    category: "retirement",
    subType: "other",
    owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }] as AccountOwner[],
  },
];

const SALARIES: SalaryOption[] = [
  { id: "inc-1", name: "Base Salary", ownerLabel: "Harold" },
  { id: "inc-2", name: "Base Salary", ownerLabel: "Rhonda" },
];

function renderDialog(opts: { editing?: SavingsRuleRow } = {}) {
  render(
    <SavingsRuleDialog
      clientId="c1"
      accounts={ACCOUNTS}
      open
      onOpenChange={() => {}}
      onSaved={() => {}}
      editing={opts.editing}
      clientInfo={{ milestones: MILESTONES, planStartYear: NOW, planEndYear: NOW + 45 }}
      ownerNames={{ clientName: "Harold Mueller", spouseName: "Rhonda Mueller" }}
      familyMembers={FAMILY_MEMBERS}
      resolvedInflationRate={0.024}
      salaries={SALARIES}
    />
  );
}

describe("SavingsRuleDialog — salary basis", () => {
  beforeEach(() => {
    submitSpy.mockClear();
  });

  it("hides the panel in dollar mode", () => {
    // Default state (no `editing`) infers contribMode "amount" and matchMode
    // "none" — neither reads salary, so the panel has nothing to configure.
    renderDialog();
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
    // The panel is hidden (dollar mode, no match), but the rule keeps the
    // salaries it was built on so flipping to flat dollars and back isn't
    // destructive. Fixture uses "all" — deliberately NOT "owner" (the
    // default `useState` would fall back to), so a dropped-field
    // implementation that ignores `editing.salaryBasis` reads red here.
    renderDialog({
      editing: {
        id: "sr-1",
        accountId: "acct-client",
        annualAmount: "10000",
        annualPercent: null,
        contributeMax: false,
        startYear: NOW,
        endYear: NOW + 10,
        startYearRef: null,
        endYearRef: null,
        employerMatchPct: null,
        employerMatchCap: null,
        employerMatchAmount: null,
        salaryBasis: "all",
        salaryIncomeIds: [],
      },
    });
    expect(screen.queryByText(/salary basis/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(submitSpy).toHaveBeenCalled());
    expect(submitSpy.mock.calls[0][1].body).toMatchObject({ salaryBasis: "all" });
  });
});
