// @vitest-environment jsdom
/**
 * A salary's default END YEAR must follow the OWNER — the spouse's salary stops
 * when the SPOUSE retires, not when the primary client does.
 *
 * `defaultIncomeRefs` has always returned `spouse_retirement` for a spouse
 * owner, and IncomeDialog has always re-snapped the refs on an owner change.
 * What the advisor SAW was stale: MilestoneYearPicker copied `value`/`yearRef`
 * into state at mount and never adopted a later prop change, so the dialog held
 * the spouse's year while the picker still read the client's. These assertions
 * are on the pickers for that reason — a save-payload assertion passes on a
 * dialog that shows the advisor the wrong year.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

const NOW = new Date().getFullYear();

// The two retirements have to be DIFFERENT years, or "follows the owner" and
// "always uses the client" agree and the test cannot tell them apart.
// Client retires at NOW+15, spouse at NOW+20; as END refs both resolve to the
// year before (last year of the working state).
const CLIENT_RET = NOW + 15;
const SPOUSE_RET = NOW + 20;

const MILESTONES = buildClientMilestones(
  {
    dateOfBirth: `${NOW - 50}-03-02`,
    retirementAge: 65,
    planEndAge: 95,
    spouseDob: `${NOW - 45}-07-11`,
    spouseRetirementAge: 65,
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
  familyMembers: [],
  clientInfo: {
    milestones: MILESTONES,
    planStartYear: NOW,
    planEndYear: NOW + 45,
    clientRetirementYear: CLIENT_RET,
    clientEndYear: NOW + 45,
  },
};

/** Opens the Add Income dialog (the Income panel's "+ Add" is the first one). */
function openAddIncome() {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} />
    </ClientAccessProvider>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[0]);
}

const endYearInput = () => screen.getByLabelText(/^end year$/i) as HTMLInputElement;

describe("IncomeDialog salary end year follows the owner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // The control: without it, a dialog that showed the spouse's retirement for
  // BOTH owners would pass the spouse case below.
  it("ends a client salary at the client's retirement", () => {
    openAddIncome();

    expect(endYearInput().value).toBe(String(CLIENT_RET - 1));
    expect(screen.getAllByTitle("Harold Retirement").length).toBeGreaterThan(0);
  });

  it("moves the end year to the spouse's retirement when the owner switches", () => {
    openAddIncome();
    fireEvent.click(screen.getByRole("button", { name: "Rhonda" }));

    expect(endYearInput().value).toBe(String(SPOUSE_RET - 1));
    expect(screen.getAllByTitle("Rhonda Retirement").length).toBeGreaterThan(0);
  });

  // Switching back has to move it back — the re-snap must not be a one-shot
  // that fires only on the first owner change.
  it("moves back to the client's retirement when the owner switches back", () => {
    openAddIncome();
    fireEvent.click(screen.getByRole("button", { name: "Rhonda" }));
    fireEvent.click(screen.getByRole("button", { name: "Harold" }));

    expect(endYearInput().value).toBe(String(CLIENT_RET - 1));
    expect(screen.getAllByTitle("Harold Retirement").length).toBeGreaterThan(0);
  });

  // An explicit edit is the advisor's, not the default's. Once they type a
  // year, a later owner change must leave it alone.
  it("leaves an explicitly edited end year alone on a later owner change", () => {
    openAddIncome();
    fireEvent.change(endYearInput(), { target: { value: String(NOW + 30) } });
    fireEvent.click(screen.getByRole("button", { name: "Rhonda" }));

    expect(endYearInput().value).toBe(String(NOW + 30));
  });
});
