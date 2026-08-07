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
  // The advisor only ever sees the pickers, so assert them too: they open on
  // the plan's first/last year and must re-date to the beneficiary's span.
  it("shows the beneficiary's span in the year pickers, not the plan bounds", () => {
    pickEducationFor(FM_CHILD);

    expect((screen.getByLabelText(/^start year$/i) as HTMLInputElement).value).toBe(String(NOW + 8));
    expect((screen.getByLabelText(/^end year$/i) as HTMLInputElement).value).toBe(String(NOW + 11));
  });

  // Re-dating has to survive a change of mind — the second pick must not be
  // ignored on the grounds that the picker already moved off its default once.
  it("re-dates again when the beneficiary changes", () => {
    pickEducationFor(FM_CHILD);
    fireEvent.change(screen.getByLabelText(/^for$/i), { target: { value: FM_TEEN } });

    expect((screen.getByLabelText(/^start year$/i) as HTMLInputElement).value).toBe(String(NOW));
    expect((screen.getByLabelText(/^end year$/i) as HTMLInputElement).value).toBe(String(NOW + 3));
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

  // The control for the three above: with no DOB the dialog must not guess a
  // year, so "the years are right" cannot be passing on a dialog that always
  // writes the same dates.
  it("names the goal but leaves the dates alone for a member with no birth date", async () => {
    pickEducationFor(FM_NO_DOB);
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("Sam - Education");

    // Untouched, so still the plan bounds the dialog opened on.
    const body = await saveAndReadBody();
    expect(body.startYear).toBe(String(NOW));
    expect(body.endYear).toBe(String(NOW + 45));
  });
});
