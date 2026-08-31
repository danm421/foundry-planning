// @vitest-environment jsdom
/**
 * The Add/Edit Account dialog is the THIRD place a percent-of-salary savings
 * rule can be built, after the rule dialog and the Income & Expenses view.
 * It has two distinct entry points, and both are covered here:
 *
 *  - CREATE mode renders its own inline savings form, so it needs its own copy
 *    of the Salary basis panel and has to put the two keys on the rule it POSTs.
 *  - EDIT mode delegates to `SavingsRuleDialog`, which already has the panel —
 *    but it seeds that dialog from `GET /api/clients/[id]/savings-rules`, and
 *    that route used to return the `salary_basis` COLUMN without the join-table
 *    ids. The panel then fell back to "owner" and the next Save Changes wiped
 *    the advisor's picks. The fixture in that test is the exact shape
 *    `src/app/api/clients/[id]/savings-rules/__tests__/route.test.ts` pins the
 *    route to produce, so the two halves cannot drift apart.
 *
 * This form saves through `useScenarioWriter().submit`, not a bare `fetch`, so
 * the hook is mocked with a hoisted spy (same idiom as
 * `savings-rule-dialog-salary-basis.test.tsx`; an untyped `vi.fn()` is
 * deliberate — a typed one infers an exact `[]` parameter tuple and trips
 * indexing into `.mock.calls`). One save fires SEVERAL submits — the account
 * first, then the savings rule — so calls are selected by `targetKind`, never
 * by index.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-1/details/net-worth",
}));

const submitSpy = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "acct-1" }) })
);
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ scenarioActive: false, submit: submitSpy }),
}));

import AddAccountForm, { type AccountFormInitial } from "../add-account-form";
import type { SalaryOption } from "../salary-basis-fields";

const FAMILY_MEMBERS = [
  { id: "fm-client", role: "client" as const, firstName: "Jane" },
  { id: "fm-spouse", role: "spouse" as const, firstName: "John" },
];

// TWO salaries, not one: `toggleOne` promotes to basis "all" the moment every
// box is checked, so a single-salary fixture could never produce "selected".
const SALARIES: SalaryOption[] = [
  { id: "inc-1", name: "Base Salary", ownerLabel: "Jane" },
  { id: "inc-2", name: "Base Salary", ownerLabel: "John" },
];

const EDIT_INITIAL: AccountFormInitial = {
  id: "acct-1",
  name: "Jane 401(k)",
  category: "retirement",
  subType: "401k",
  owner: "client",
  value: "250000",
  basis: "0",
  growthRate: "0.07",
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

/** The row shape `GET /api/clients/[id]/savings-rules` returns for a rule the
 *  advisor built on one hand-picked salary. */
const STORED_SELECTED_RULE = {
  id: "sr-1",
  accountId: "acct-1",
  annualAmount: "0",
  annualPercent: "0.06",
  startYear: 2026,
  endYear: 2040,
  employerMatchPct: null,
  employerMatchCap: null,
  employerMatchAmount: null,
  salaryBasis: "selected",
  salaryIncomeIds: ["inc-1"],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  submitSpy.mockClear();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderForm(props: Partial<React.ComponentProps<typeof AddAccountForm>> = {}) {
  return render(
    <AddAccountForm
      clientId="client-1"
      category="retirement"
      mode="create"
      familyMembers={FAMILY_MEMBERS}
      entities={[]}
      initialTab="savings"
      salaries={SALARIES}
      {...props}
    />,
  );
}

/** Both the contribution and the employer-match toggle rows carry a "% of
 *  salary" button, so every query has to be scoped to one of them. "Dollar
 *  amount" and "Flat $" are each unique to their own row. */
const contribToggles = () =>
  within(screen.getByRole("button", { name: /dollar amount/i }).closest("div")!);
const matchToggles = () =>
  within(screen.getByRole("button", { name: /flat \$/i }).closest("div")!);

const pickSubType = (value: string) =>
  fireEvent.change(screen.getByLabelText(/account type/i), { target: { value } });

/** The savings-rule submit, found by kind — a save fires the ACCOUNT edit
 *  first, so `calls[0]` is never the rule. Throws rather than returning
 *  undefined when no rule was submitted at all. */
function savingsRuleBody() {
  const call = submitSpy.mock.calls.find((c) => c[0]?.targetKind === "savings_rule");
  if (!call) {
    throw new Error(
      `No savings_rule submit. Kinds seen: ${JSON.stringify(
        submitSpy.mock.calls.map((c) => c[0]?.targetKind),
      )}`,
    );
  }
  return call[1].body;
}

describe("AddAccountForm — savings salary basis", () => {
  it("offers the panel on a new 401(k) in percent mode", async () => {
    renderForm();
    pickSubType("401k");
    expect(screen.queryByText(/salary basis/i)).not.toBeInTheDocument();

    await userEvent.click(contribToggles().getByRole("button", { name: /% of salary/i }));
    expect(screen.getByText(/salary basis/i)).toBeInTheDocument();

    // Toggling back must UNMOUNT it. A panel that only ever fails to appear
    // and one that appears and never leaves both read "absent" at the start.
    await userEvent.click(contribToggles().getByRole("button", { name: /dollar amount/i }));
    expect(screen.queryByText(/salary basis/i)).not.toBeInTheDocument();
  });

  it("offers the panel when only the employer match is a percent", async () => {
    // The match resolves against the same salary number the contribution does
    // (one `salaryByRuleId` per rule), so a dollar contribution with a percent
    // match still has something to configure.
    renderForm();
    pickSubType("401k");
    await userEvent.click(matchToggles().getByRole("button", { name: /% of salary/i }));
    expect(screen.getByText(/salary basis/i)).toBeInTheDocument();
  });

  it("takes the panel away again when the account type stops being payroll-deduction", () => {
    // IRAs aren't payroll-deduction vehicles, so they have no percent mode and
    // nothing to base one on. PERCENT_CONTRIB_SUB_TYPES is the gate — and it
    // has to stay live, so the switch below is a REAL one: `traditional_ira`
    // is already the default retirement subtype, so starting there would fire
    // no onChange and prove only that the gate holds on first render.
    renderForm();
    pickSubType("401k");
    expect(contribToggles().getByRole("button", { name: /% of salary/i })).toBeInTheDocument();

    pickSubType("traditional_ira");
    expect(screen.queryByRole("button", { name: /% of salary/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/salary basis/i)).not.toBeInTheDocument();
  });

  it("posts the basis with the new account's savings rule", async () => {
    renderForm();
    pickSubType("401k");
    await userEvent.click(contribToggles().getByRole("button", { name: /% of salary/i }));
    await userEvent.type(screen.getByLabelText(/contribution \(% of salary\)/i), "10");
    await userEvent.click(screen.getByLabelText(/base salary.*jane/i));

    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(
        submitSpy.mock.calls.some((c) => c[0]?.targetKind === "savings_rule"),
      ).toBe(true),
    );
    expect(savingsRuleBody()).toMatchObject({
      annualPercent: "0.1",
      salaryBasis: "selected",
      salaryIncomeIds: ["inc-1"],
    });
  });

  it("defaults a percent rule to the owner's salary when nothing is picked", async () => {
    renderForm();
    pickSubType("401k");
    await userEvent.click(contribToggles().getByRole("button", { name: /% of salary/i }));
    await userEvent.type(screen.getByLabelText(/contribution \(% of salary\)/i), "10");

    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(
        submitSpy.mock.calls.some((c) => c[0]?.targetKind === "savings_rule"),
      ).toBe(true),
    );
    expect(savingsRuleBody()).toMatchObject({
      salaryBasis: "owner",
      salaryIncomeIds: [],
    });
  });
});

describe("AddAccountForm — editing a stored rule from the Savings tab", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("savings-rules")
        ? { ok: true, json: async () => [STORED_SELECTED_RULE] }
        : { ok: true, json: async () => [] },
    );
  });

  it("reopens with the advisor's salaries still checked, and re-sends them", async () => {
    renderForm({ mode: "edit", initial: EDIT_INITIAL });

    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));

    // Pre-CHECKED, not merely offered: `salaries` controls which boxes exist,
    // `salaryIncomeIds` controls which are ticked. Losing the ids leaves the
    // panel on "owner" with every box clear.
    expect(screen.getByLabelText(/base salary.*jane/i)).toBeChecked();
    expect(screen.getByLabelText(/base salary.*john/i)).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(
        submitSpy.mock.calls.some((c) => c[0]?.targetKind === "savings_rule"),
      ).toBe(true),
    );
    // A touch-nothing re-save must write back what was there. When the ids are
    // missing the dialog sends `salaryBasis: "owner"` and the write path runs
    // `replaceSalaryIncomes(tx, ruleId, [])` — the advisor's picks are deleted
    // with no warning and the plan's contribution silently changes.
    expect(savingsRuleBody()).toMatchObject({
      salaryBasis: "selected",
      salaryIncomeIds: ["inc-1"],
    });
  });
});
