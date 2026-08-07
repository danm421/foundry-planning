// @vitest-environment jsdom
/**
 * The education goal's date auto-fill on the detailed Inflows & Outflows
 * expense form (ExpenseDialog inside IncomeExpensesView) — the same dialog the
 * guided walkthrough's Goals step renders. Picking a beneficiary time-boxes the
 * goal to four years starting the year they turn 18, or the current year once
 * that birthday has passed.
 *
 * Asserted on the SAVE payload, not the year pickers: the payload is what
 * reaches the DB. Birth years are stated relative to the real current year so
 * the expectations do not rot with the wall clock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details/income-expenses",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { buildClientMilestones } from "@/lib/milestones";

const fetchMock = vi.fn();

const NOW = new Date().getFullYear();

const FM_CHILD = "11111111-1111-4111-8111-111111111111";
const FM_TEEN = "22222222-2222-4222-8222-222222222222";
const FM_ADULT = "33333333-3333-4333-8333-333333333333";
const FM_NO_DOB = "44444444-4444-4444-8444-444444444444";

// The four branches of `handleForChange`: a 10-year-old (turns 18 in eight
// years), an 18-year-old (the boundary — that birthday lands this year), an
// adult well past 18, and a member with no DOB at all.
const FAMILY_MEMBERS = [
  { id: FM_CHILD, firstName: "Kelly", role: "child", dateOfBirth: `${NOW - 10}-06-15` },
  { id: FM_TEEN, firstName: "Rae", role: "child", dateOfBirth: `${NOW - 18}-06-15` },
  { id: FM_ADULT, firstName: "Pat", role: "child", dateOfBirth: `${NOW - 30}-06-15` },
  { id: FM_NO_DOB, firstName: "Sam", role: "child", dateOfBirth: null },
];

// Real milestones, because that is what every production caller passes: with
// them the dialog renders MilestoneYearPicker, and without them it falls back
// to plain number inputs. Testing the fallback would leave the picker — the
// half that actually shows the advisor a year — unexercised.
const MILESTONES = buildClientMilestones(
  {
    dateOfBirth: `${NOW - 50}-03-02`,
    retirementAge: 65,
    planEndAge: 95,
    spouseDob: null,
    spouseRetirementAge: null,
  } as never,
  NOW,
  NOW + 45,
);

const BASE_PROPS = {
  clientId: "c1",
  initialIncomes: [],
  initialExpenses: [],
  initialSavingsRules: [],
  accounts: [],
  ownerNames: { clientName: "Harold Mueller", spouseName: "Rhonda Mueller" },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  flowScenarioFields: {},
  resolvedInflationRate: 0.024,
  familyMembers: FAMILY_MEMBERS,
  clientInfo: {
    milestones: MILESTONES,
    planStartYear: NOW,
    planEndYear: NOW + 45,
    clientRetirementYear: NOW + 15,
    clientEndYear: NOW + 45,
  },
};

/** Opens the Add Expense dialog, switches it to education, picks `fmId`. */
function pickEducationFor(fmId: string) {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} />
    </ClientAccessProvider>,
  );
  // Two "+ Add" buttons exist (Income panel first, Expenses panel second).
  fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[1]);
  fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "education" } });
  fireEvent.change(screen.getByLabelText(/^for$/i), { target: { value: fmId } });
}

async function saveAndReadBody(): Promise<Record<string, unknown>> {
  fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "30000" } });
  fireEvent.click(screen.getByRole("button", { name: /add expense/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/expenses"));
  expect(call).toBeTruthy();
  return JSON.parse((call![1] as RequestInit).body as string);
}

describe("ExpenseDialog education date auto-fill", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-expense-id", ok: true, targetId: "new-expense-id" }),
    });
  });

  it("titles the goal after the beneficiary", () => {
    pickEducationFor(FM_CHILD);
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("Kelly - Education");
  });

  it("starts four years at the year a 10-year-old turns 18", async () => {
    pickEducationFor(FM_CHILD);

    const body = await saveAndReadBody();
    expect(body.startYear).toBe(String(NOW + 8));
    expect(body.endYear).toBe(String(NOW + 11));
  });

  // The payload assertions above pass even when the year pickers still show
  // their mount-time defaults, because the payload reads dialog state directly.
  // The advisor only ever sees the pickers, so assert them too. Education ends
  // on a DURATION, so the end picker reads "4 years", not a calendar year.
  it("shows the beneficiary's start year and a four-year duration", () => {
    pickEducationFor(FM_CHILD);

    expect((screen.getByLabelText(/^start year$/i) as HTMLInputElement).value).toBe(String(NOW + 8));
    expect((screen.getByLabelText(/^end year$/i) as HTMLInputElement).value).toBe("4");
    expect(screen.getByText(new RegExp(`years → ${NOW + 11}`))).toBeTruthy();
  });

  // Re-dating has to survive a change of mind — the second pick must not be
  // ignored on the grounds that the picker already moved off its default once.
  it("re-dates again when the beneficiary changes", () => {
    pickEducationFor(FM_CHILD);
    fireEvent.change(screen.getByLabelText(/^for$/i), { target: { value: FM_TEEN } });

    expect((screen.getByLabelText(/^start year$/i) as HTMLInputElement).value).toBe(String(NOW));
    expect((screen.getByLabelText(/^end year$/i) as HTMLInputElement).value).toBe("4");
    expect(screen.getByText(new RegExp(`years → ${NOW + 3}`))).toBeTruthy();
  });

  // The point of the duration framing: moving the start carries the end with
  // it, instead of stranding a four-year programme against a fixed end date.
  it("carries the end along when the advisor moves the start year", async () => {
    pickEducationFor(FM_CHILD);
    fireEvent.change(screen.getByLabelText(/^start year$/i), { target: { value: String(NOW + 9) } });

    expect(screen.getByText(new RegExp(`years → ${NOW + 12}`))).toBeTruthy();
    const body = await saveAndReadBody();
    expect(body.startYear).toBe(String(NOW + 9));
    expect(body.endYear).toBe(String(NOW + 12));
  });

  // The boundary: an 18th birthday inside the current year starts now, and is
  // neither pushed out a year nor floored from somewhere in the past.
  it("starts this year for a beneficiary who turns 18 this year", async () => {
    pickEducationFor(FM_TEEN);

    const body = await saveAndReadBody();
    expect(body.startYear).toBe(String(NOW));
    expect(body.endYear).toBe(String(NOW + 3));
  });

  it("floors the start at the current year for a beneficiary past 18", async () => {
    pickEducationFor(FM_ADULT);

    const body = await saveAndReadBody();
    expect(body.startYear).toBe(String(NOW));
    expect(body.endYear).toBe(String(NOW + 3));
  });

  // The control for the four above: with no DOB the dialog must not guess a
  // start year. The saved START REF is what separates the two cases — a picked
  // beneficiary re-dates to a literal year and drops the ref, while this one
  // stays pinned to the plan's first year. Without it "the years are right"
  // could pass on a dialog that always writes the same dates, since a
  // beneficiary already past 18 lands on the plan's first year too.
  it("names the goal but does not re-date for a member with no birth date", async () => {
    pickEducationFor(FM_NO_DOB);
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("Sam - Education");

    const body = await saveAndReadBody();
    expect(body.startYearRef).toBe("plan_start");
    expect(body.startYear).toBe(String(NOW));
    expect(body.endYear).toBe(String(NOW + 3));
  });

  it("drops the start ref when a beneficiary with a birth date is picked", async () => {
    pickEducationFor(FM_CHILD);

    const body = await saveAndReadBody();
    expect(body.startYearRef).toBeNull();
  });
});

// The four-year duration is education's alone. Without this, nulling the end
// ref for every new expense would pass every test above.
describe("ExpenseDialog end-year framing by type", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-expense-id", ok: true, targetId: "new-expense-id" }),
    });
  });

  it("runs a non-education expense to the plan's last year", async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[1]);

    // No beneficiary to auto-title this one, and Name is required.
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Housing" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /add expense/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/expenses"));
    const body = JSON.parse((call![1] as RequestInit).body as string);

    expect(body.endYearRef).toBe("plan_end");
    expect(body.endYear).toBe(String(NOW + 45));
  });

  // Dan's actual entry point: the walkthrough's Goals step opens the dialog
  // already on education, so the four-year framing has to be there at MOUNT —
  // before any beneficiary is picked — not only after a type change.
  it("opens on the four-year duration from the Goals step's + Add", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} section="goals" />
      </ClientAccessProvider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[0]);

    expect((screen.getByLabelText(/^type$/i) as HTMLSelectElement).value).toBe("education");
    expect((screen.getByLabelText(/^end year$/i) as HTMLInputElement).value).toBe("4");
    expect(screen.getByText(new RegExp(`years → ${NOW + 3}`))).toBeTruthy();
  });

  // The four-year default is for NEW goals only. A saved goal keeps its own
  // span — re-framing the picker must not silently re-length the advisor's work.
  it("keeps a saved goal's own span when editing it", () => {
    const SIX_YEAR_GOAL = {
      id: "exp-1",
      type: "education",
      name: "Kelly - Education",
      annualAmount: "30000",
      startYear: NOW + 8,
      endYear: NOW + 13,
      startYearRef: null,
      endYearRef: null,
      growthRate: "0.024",
      growthSource: "inflation",
      isGoal: true,
    };
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} section="goals" initialExpenses={[SIX_YEAR_GOAL] as never} />
      </ClientAccessProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Edit Kelly - Education$/ }));

    expect((screen.getByLabelText(/^end year$/i) as HTMLInputElement).value).toBe("6");
    expect(screen.getByText(new RegExp(`years → ${NOW + 13}`))).toBeTruthy();
  });

  it("switches an in-progress expense to the four-year duration on type change", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[1]);
    expect((screen.getByLabelText(/^end year$/i) as HTMLInputElement).value).toBe(String(NOW + 45));

    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "education" } });

    expect((screen.getByLabelText(/^end year$/i) as HTMLInputElement).value).toBe("4");
    expect(screen.getByText(new RegExp(`years → ${NOW + 3}`))).toBeTruthy();
  });
});
