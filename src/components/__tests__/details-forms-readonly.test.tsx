// @vitest-environment jsdom
/**
 * TDD tests for read-only gating in WillsPanel, InsurancePanel, and TaxRatesForm.
 *
 * Under { permission: "view" } mutation affordances (Add/Edit/Delete buttons,
 * move-up/down buttons, submit buttons) must be absent.
 * Under { permission: "edit" } they must be present.
 *
 * Components are mounted with leaf dialogs mocked so jsdom can render them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Mock heavy dialog components that pull in 3rd-party libs
vi.mock("@/components/bequest-dialog", () => ({ default: () => null }));
vi.mock("@/components/insurance-policy-dialog", () => ({ default: () => null }));
vi.mock("@/components/confirm-delete-dialog", () => ({ default: () => null }));

// Mock hooks that reach outside
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: vi.fn(), scenarioActive: false }),
}));
vi.mock("@/components/toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import WillsPanel, {
  type WillsPanelPrimary,
  type WillsPanelWill,
} from "@/components/wills-panel";
import InsurancePanel, { type InsurancePanelProps } from "@/components/insurance-panel";
import TaxRatesForm from "@/components/forms/tax-rates-form";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { LifeInsurancePolicy } from "@/engine/types";

// ---------------------------------------------------------------------------
// Fixtures — WillsPanel
// ---------------------------------------------------------------------------

const CLIENT_ID = "test-client-id";

const WILLS_PRIMARY: WillsPanelPrimary = {
  firstName: "Alice",
  lastName: "Test",
  spouseName: null,
  spouseLastName: null,
};

const WILL_WITH_BEQUEST: WillsPanelWill = {
  id: "will-1",
  grantor: "client",
  bequests: [
    {
      kind: "asset",
      id: "bq-1",
      name: "Brokerage bequest",
      assetMode: "specific",
      accountId: "acct-1",
      percentage: 50,
      condition: "always",
      sortOrder: 0,
      recipients: [
        {
          recipientKind: "family_member",
          recipientId: "fm-1",
          percentage: 100,
          sortOrder: 0,
        },
      ],
    },
  ],
  residuaryRecipients: [],
};

const WILLS_BASE_PROPS = {
  clientId: CLIENT_ID,
  primary: WILLS_PRIMARY,
  accounts: [{ id: "acct-1", name: "Brokerage", category: "taxable", value: 100000 }],
  liabilities: [],
  familyMembers: [{ id: "fm-1", firstName: "Bob", lastName: "Test" }],
  externalBeneficiaries: [],
  entities: [],
  initialWills: [WILL_WITH_BEQUEST],
};

// ---------------------------------------------------------------------------
// Fixtures — InsurancePanel
// ---------------------------------------------------------------------------

const TERM_POLICY: LifeInsurancePolicy = {
  policyType: "term",
  faceValue: 500000,
  costBasis: 0,
  premiumAmount: 1200,
  premiumYears: 16,
  premiumPayer: "owner",
  termIssueYear: 2024,
  termLengthYears: 20,
  endsAtInsuredRetirement: false,
  cashValueGrowthMode: "basic",
  premiumScheduleMode: "off",
  deathBenefitScheduleMode: "off",
  incomeScheduleMode: "off",
  postPayoutGrowthRate: 0.05,
  cashValueSchedule: [],
};

const INSURANCE_ACCOUNT = {
  id: "ins-acct-1",
  name: "Term Life Policy",
  category: "life_insurance" as const,
  subType: "term" as const,
  ownerRef: { kind: "family" as const, id: "fm-1" },
  insuredPerson: "client" as const,
  value: "0",
};

const INSURANCE_BASE_PROPS: InsurancePanelProps = {
  clientId: CLIENT_ID,
  clientFirstName: "Alice",
  spouseFirstName: null,
  accounts: [INSURANCE_ACCOUNT],
  policies: { "ins-acct-1": TERM_POLICY },
  entities: [],
  familyMembers: [
    {
      id: "fm-1",
      firstName: "Alice",
      lastName: "Test",
      relationship: "other",
      role: "client",
      dateOfBirth: "1960-05-15",
      notes: null,
    },
  ],
  externalBeneficiaries: [],
  modelPortfolios: [],
  resolvedInflationRate: 0.03,
  scheduleStartYear: 2024,
  scheduleEndYear: 2060,
};

// ---------------------------------------------------------------------------
// Fixtures — TaxRatesForm
// ---------------------------------------------------------------------------

const TAX_RATES_BASE_PROPS = {
  clientId: CLIENT_ID,
  flatFederalRate: "0.24",
  flatStateRate: "0.05",
  estateAdminExpenses: "0",
  flatStateEstateRate: "0",
  residenceState: null,
  irdTaxRate: "0.37",
  probateCostRate: "0.03",
  outOfHouseholdDniRate: "0.37",
  priorTaxableGiftsClient: "0",
  priorTaxableGiftsSpouse: "0",
  hasSpouse: false,
  clientFirstName: "Alice",
};

// ---------------------------------------------------------------------------
// WillsPanel tests
// ---------------------------------------------------------------------------

describe("WillsPanel read-only gating", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hides Delete will, Add bequest, move-up/down, Edit, Delete bequest buttons under permission='view'", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <WillsPanel {...WILLS_BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // "Delete will" button must not be rendered
    expect(screen.queryByRole("button", { name: /delete will/i })).toBeNull();

    // "+ Add bequest" button must not be rendered
    expect(screen.queryByRole("button", { name: /\+ add bequest/i })).toBeNull();

    // Move-up button must not be rendered
    expect(screen.queryByRole("button", { name: /move up/i })).toBeNull();

    // Move-down button must not be rendered
    expect(screen.queryByRole("button", { name: /move down/i })).toBeNull();

    // Edit bequest button must not be rendered
    expect(screen.queryByRole("button", { name: /edit bequest/i })).toBeNull();

    // Delete bequest button must not be rendered
    expect(screen.queryByRole("button", { name: /delete bequest/i })).toBeNull();

    // Bequest data should still be visible
    expect(screen.getByText("Brokerage bequest")).toBeTruthy();
  });

  it("shows Delete will, Add bequest, move-up/down, Edit, Delete bequest under permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <WillsPanel {...WILLS_BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // "Delete will" button must be present
    expect(screen.queryByRole("button", { name: /delete will/i })).not.toBeNull();

    // "+ Add bequest" button must be present
    expect(screen.queryByRole("button", { name: /\+ add bequest/i })).not.toBeNull();

    // Edit bequest button must be present
    expect(screen.queryByRole("button", { name: /edit bequest/i })).not.toBeNull();

    // Delete bequest button must be present
    expect(screen.queryByRole("button", { name: /delete bequest/i })).not.toBeNull();

    // Bequest data should be visible
    expect(screen.getByText("Brokerage bequest")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// InsurancePanel tests
// ---------------------------------------------------------------------------

describe("InsurancePanel read-only gating", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hides Add policy and Edit buttons under permission='view'", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <InsurancePanel {...INSURANCE_BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // "+ Add policy" button must not be rendered
    expect(screen.queryByRole("button", { name: /\+ add policy/i })).toBeNull();

    // Per-row "Edit" button must not be rendered
    expect(screen.queryByRole("button", { name: /edit term life policy/i })).toBeNull();

    // Data must still be visible
    expect(screen.getByText("Term Life Policy")).toBeTruthy();
  });

  it("shows Add policy and Edit buttons under permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <InsurancePanel {...INSURANCE_BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // "+ Add policy" button must be present
    expect(screen.queryByRole("button", { name: /\+ add policy/i })).not.toBeNull();

    // Per-row "Edit" button must be present
    expect(screen.queryByRole("button", { name: /edit term life policy/i })).not.toBeNull();

    // Data must still be visible
    expect(screen.getByText("Term Life Policy")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TaxRatesForm tests
// ---------------------------------------------------------------------------

describe("TaxRatesForm read-only gating", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hides Save submit button under permission='view' but shows current value", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <TaxRatesForm {...TAX_RATES_BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // Save button must not be rendered
    const saveBtn = screen.queryByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeNull();

    // Current value must still be visible — federal rate input shows 24.00
    const federalInput = screen.queryByRole("spinbutton", { name: /federal rate/i }) ??
      document.querySelector("#flatFederalRate") as HTMLElement | null;
    expect(federalInput).not.toBeNull();
  });

  it("shows Save submit button under permission='edit'", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TaxRatesForm {...TAX_RATES_BASE_PROPS} />
      </ClientAccessProvider>,
    );

    // Save button must be present
    const saveBtn = screen.queryByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeNull();
  });
});
