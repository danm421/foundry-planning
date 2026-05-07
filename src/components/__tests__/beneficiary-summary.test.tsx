// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BeneficiarySummary from "../beneficiary-summary";
import type {
  AccountLite,
  Designation,
  Entity,
  ExternalBeneficiary,
  FamilyMember,
} from "../family-view";

const u = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;

const spouse: FamilyMember = {
  id: u("fm1"),
  firstName: "Linda",
  lastName: "Smith",
  relationship: "other",
  dateOfBirth: null,
  notes: null,
};

const daughter: FamilyMember = {
  id: u("fm2"),
  firstName: "Jane",
  lastName: "Smith",
  relationship: "child",
  dateOfBirth: null,
  notes: null,
};

const charity: ExternalBeneficiary = {
  id: u("ex1"),
  name: "Anthropic Impact Fund",
  kind: "charity",
  notes: null,
};

const rothAccount: AccountLite = {
  id: u("a1"),
  name: "Roth IRA",
  category: "retirement",
  ownerFamilyMemberId: null,
  ownerEntityId: null,
};

const brokerageAccount: AccountLite = {
  id: u("a2"),
  name: "Brokerage",
  category: "taxable",
  ownerFamilyMemberId: null,
  ownerEntityId: null,
};

const cashAccount: AccountLite = {
  id: u("a3"),
  name: "High-yield Savings",
  category: "cash",
  ownerFamilyMemberId: null,
  ownerEntityId: null,
};

const retirementDesignation: Designation = {
  id: u("d1"),
  accountId: u("a1"),
  entityId: null,
  tier: "primary",
  percentage: 100,
  familyMemberId: spouse.id,
  externalBeneficiaryId: null,
  entityIdRef: null,
  householdRole: null,
  sortOrder: 0,
  targetKind: "account",
};

const brokeragePrimary1: Designation = {
  id: u("d2"),
  accountId: u("a2"),
  entityId: null,
  tier: "primary",
  percentage: 50,
  familyMemberId: daughter.id,
  externalBeneficiaryId: null,
  entityIdRef: null,
  householdRole: null,
  sortOrder: 0,
  targetKind: "account",
};

const brokerageContingent: Designation = {
  id: u("d3"),
  accountId: u("a2"),
  entityId: null,
  tier: "contingent",
  percentage: 100,
  familyMemberId: null,
  externalBeneficiaryId: charity.id,
  entityIdRef: null,
  householdRole: null,
  sortOrder: 0,
  targetKind: "account",
};

const trustEntity: Entity = {
  id: u("e1"),
  name: "Marital GST Trust",
  entityType: "trust",
  notes: null,
  includeInPortfolio: false,
  isGrantor: true,
  value: "0",
  basis: "0",
  owners: [],
  owner: null,
  grantor: "client",
  beneficiaries: null,
  trustSubType: "bypass",
  isIrrevocable: true,
  trustee: "Bank Corp",
  trustEnds: null,
  distributionMode: null,
  distributionAmount: null,
  distributionPercent: null,
};

const trustDesignation: Designation = {
  id: u("d4"),
  accountId: null,
  entityId: trustEntity.id,
  tier: "primary",
  percentage: 100,
  familyMemberId: daughter.id,
  externalBeneficiaryId: null,
  entityIdRef: null,
  householdRole: null,
  sortOrder: 0,
  targetKind: "trust",
};

const baseProps = {
  accounts: [rothAccount, brokerageAccount, cashAccount],
  entities: [trustEntity],
  designations: [] as Designation[],
  members: [spouse, daughter],
  externals: [charity],
  onEditAccount: () => {},
  onEditEntity: () => {},
};

describe("BeneficiarySummary", () => {
  it("renders an account card for an account with designations", () => {
    render(<BeneficiarySummary {...baseProps} designations={[retirementDesignation]} />);
    expect(screen.getByText(/Roth IRA/)).toBeDefined();
    expect(screen.getByText(/Linda Smith — 100%/)).toBeDefined();
  });

  it("omits accounts without designations", () => {
    render(<BeneficiarySummary {...baseProps} designations={[retirementDesignation]} />);
    expect(screen.queryByText(/Brokerage/)).toBeNull();
    expect(screen.queryByText(/High-yield Savings/)).toBeNull();
  });

  it("shows TOD tag for a taxable account with designations", () => {
    render(
      <BeneficiarySummary
        {...baseProps}
        designations={[brokeragePrimary1, brokerageContingent]}
      />,
    );
    expect(screen.getByText(/Brokerage/)).toBeDefined();
    expect(screen.getByText(/TOD/)).toBeDefined();
  });

  it("shows TOD tag for a cash account with designations", () => {
    const cashDesignation: Designation = {
      ...retirementDesignation,
      id: u("d5"),
      accountId: cashAccount.id,
    };
    render(<BeneficiarySummary {...baseProps} designations={[cashDesignation]} />);
    expect(screen.getByText(/High-yield Savings/)).toBeDefined();
    expect(screen.getByText(/TOD/)).toBeDefined();
  });

  it("does not show TOD tag for retirement accounts", () => {
    render(<BeneficiarySummary {...baseProps} designations={[retirementDesignation]} />);
    expect(screen.queryByText(/TOD/)).toBeNull();
  });

  it("renders primary and contingent tiers separately", () => {
    render(
      <BeneficiarySummary
        {...baseProps}
        designations={[brokeragePrimary1, brokerageContingent]}
      />,
    );
    expect(screen.getByText(/Primary:/i)).toBeDefined();
    expect(screen.getByText(/Contingent:/i)).toBeDefined();
  });

  it("renders a trust remainder card for a trust with designations", () => {
    render(<BeneficiarySummary {...baseProps} designations={[trustDesignation]} />);
    expect(screen.getByText(/Marital GST Trust/)).toBeDefined();
  });

  it("hides the trust-remainder section when no trust has designations", () => {
    render(<BeneficiarySummary {...baseProps} designations={[retirementDesignation]} />);
    expect(screen.queryByText(/Trust Remainder/i)).toBeNull();
  });

  it("hides the whole section when nothing has designations", () => {
    const { container } = render(<BeneficiarySummary {...baseProps} designations={[]} />);
    expect(container.textContent).toMatch(/No beneficiary designations yet/i);
  });

  it("calls onEditAccount with accountId when an account card's Edit button is clicked", () => {
    const onEditAccount = vi.fn();
    render(
      <BeneficiarySummary
        {...baseProps}
        designations={[retirementDesignation]}
        onEditAccount={onEditAccount}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(onEditAccount).toHaveBeenCalledWith(rothAccount.id);
  });

  it("calls onEditEntity with entityId when a trust card's Edit button is clicked", () => {
    const onEditEntity = vi.fn();
    render(
      <BeneficiarySummary
        {...baseProps}
        designations={[trustDesignation]}
        onEditEntity={onEditEntity}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(onEditEntity).toHaveBeenCalledWith(trustEntity.id);
  });
});
