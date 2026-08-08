// @vitest-environment jsdom
/**
 * A savings rule's default END YEAR follows the owner of the DESTINATION
 * account: contributions into the spouse's 401(k) stop when the SPOUSE retires.
 *
 * `defaultSavingsRuleRefs` has always taken an owner, but both dialogs called
 * it with no argument and got the `"client"` default, so every rule ended at
 * the primary client's retirement no matter whose account it funded.
 *
 * Asserted on the pickers rather than the save payload — a payload assertion
 * passes on a dialog showing the advisor a year it isn't going to save.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details/income-expenses",
}));

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({
    scenarioActive: false,
    submit: vi.fn(async () => ({ ok: true, json: async () => ({ id: "sr-1" }) })),
  }),
}));

import SavingsRuleDialog, { type SavingsRuleAccount } from "../savings-rule-dialog";
import type { AccountOwner } from "@/engine/ownership";
import { buildClientMilestones } from "@/lib/milestones";

const NOW = new Date().getFullYear();
const CLIENT_RET = NOW + 15;
const SPOUSE_RET = NOW + 20;

const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";
const FM_CHILD = "fm-child";

const FAMILY_MEMBERS = [
  { id: FM_CLIENT, role: "client" },
  { id: FM_SPOUSE, role: "spouse" },
  { id: FM_CHILD, role: "child" },
];

// The two retirements must differ, or "follows the account owner" and "always
// the client" agree and nothing here can tell them apart.
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

const solelyOwnedBy = (familyMemberId: string): AccountOwner[] => [
  { kind: "family_member", familyMemberId, percent: 1 },
];

const ACCOUNTS: SavingsRuleAccount[] = [
  {
    id: "acct-client",
    name: "Harold 401(k)",
    category: "retirement",
    subType: "401k",
    owners: solelyOwnedBy(FM_CLIENT),
  },
  {
    id: "acct-spouse",
    name: "Rhonda 401(k)",
    category: "retirement",
    subType: "401k",
    owners: solelyOwnedBy(FM_SPOUSE),
  },
  {
    id: "acct-joint",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    owners: [
      { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
    ],
  },
  {
    id: "acct-529",
    name: "Kelly 529",
    category: "education_savings",
    subType: "529",
    owners: solelyOwnedBy(FM_CHILD),
  },
];

function renderDialog() {
  render(
    <SavingsRuleDialog
      clientId="c1"
      accounts={ACCOUNTS}
      open
      onOpenChange={() => {}}
      onSaved={() => {}}
      clientInfo={{ milestones: MILESTONES, planStartYear: NOW, planEndYear: NOW + 45 }}
      ownerNames={{ clientName: "Harold Mueller", spouseName: "Rhonda Mueller" }}
      familyMembers={FAMILY_MEMBERS}
      resolvedInflationRate={0.024}
    />,
  );
}

const endYearInput = () => screen.getByLabelText(/^end year$/i) as HTMLInputElement;
const pickAccount = (id: string) =>
  fireEvent.change(screen.getByLabelText(/^account/i), { target: { value: id } });

describe("SavingsRuleDialog end year follows the destination account's owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The control: the client-owned account must still end at the client's
  // retirement, or "always the spouse" would pass the spouse case below.
  it("ends a rule into the client's account at the client's retirement", () => {
    renderDialog();

    expect(endYearInput().value).toBe(String(CLIENT_RET - 1));
    expect(screen.getAllByTitle("Harold Retirement").length).toBeGreaterThan(0);
  });

  it("re-snaps to the spouse's retirement when the spouse's account is picked", () => {
    renderDialog();
    pickAccount("acct-spouse");

    expect(endYearInput().value).toBe(String(SPOUSE_RET - 1));
    expect(screen.getAllByTitle("Rhonda Retirement").length).toBeGreaterThan(0);
  });

  it("re-snaps back when the advisor switches accounts again", () => {
    renderDialog();
    pickAccount("acct-spouse");
    pickAccount("acct-client");

    expect(endYearInput().value).toBe(String(CLIENT_RET - 1));
    expect(screen.getAllByTitle("Harold Retirement").length).toBeGreaterThan(0);
  });

  // A jointly-owned account has no single retirement to follow, so it keeps the
  // client's — the behaviour `milestones.test.ts` already pins for "joint".
  it("keeps the client's retirement for a jointly-owned account", () => {
    renderDialog();
    pickAccount("acct-spouse");
    pickAccount("acct-joint");

    expect(endYearInput().value).toBe(String(CLIENT_RET - 1));
    expect(screen.getAllByTitle("Harold Retirement").length).toBeGreaterThan(0);
  });

  // A 529's owner is a child, who has no retirement in the plan at all.
  it("keeps the client's retirement for a child-owned 529", () => {
    renderDialog();
    pickAccount("acct-spouse");
    pickAccount("acct-529");

    expect(endYearInput().value).toBe(String(CLIENT_RET - 1));
  });

  // An explicit edit is the advisor's. Changing the account afterwards must
  // not overwrite it — the guard the income dialog already carries.
  it("leaves an explicitly edited end year alone on a later account change", () => {
    renderDialog();
    fireEvent.change(endYearInput(), { target: { value: String(NOW + 30) } });
    pickAccount("acct-spouse");

    expect(endYearInput().value).toBe(String(NOW + 30));
  });

  // Editing a SAVED rule must show that rule's own years, not re-derive them.
  it("keeps a saved rule's own end year when editing it", () => {
    render(
      <SavingsRuleDialog
        clientId="c1"
        accounts={ACCOUNTS}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
        editing={{
          id: "sr-1",
          accountId: "acct-spouse",
          annualAmount: "10000",
          startYear: NOW,
          endYear: NOW + 5,
          startYearRef: "plan_start",
          endYearRef: null,
          employerMatchPct: null,
          employerMatchCap: null,
          employerMatchAmount: null,
        }}
        clientInfo={{ milestones: MILESTONES, planStartYear: NOW, planEndYear: NOW + 45 }}
        ownerNames={{ clientName: "Harold Mueller", spouseName: "Rhonda Mueller" }}
        familyMembers={FAMILY_MEMBERS}
        resolvedInflationRate={0.024}
      />,
    );

    expect(endYearInput().value).toBe(String(NOW + 5));
  });
});
