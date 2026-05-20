// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstateTransferRecipientCard } from "@/components/estate-transfer-recipient-card";
import type { RecipientGroup } from "@/lib/estate/transfer-report";

const baseGroup: RecipientGroup = {
  key: "family_member|fm-child",
  recipientKind: "family_member",
  recipientId: "fm-child",
  recipientLabel: "Janet",
  total: 1_000_000,
  netTotal: 1_000_000,
  drainsByKind: {
    federal_estate_tax: 0,
    state_estate_tax: 0,
    admin_expenses: 0,
    debts_paid: 0,
    ird_tax: 0,
  },
  byMechanism: [
    {
      mechanism: "trust_pour_out",
      mechanismLabel: "Trust Pour-Out",
      total: 1_000_000,
      assets: [
        {
          sourceAccountId: "pol-1",
          sourceLiabilityId: null,
          label: "Alice Term 20",
          amount: 1_000_000,
          basis: 0,
          conflictIds: [],
          distributionForm: "outright",
        },
      ],
    },
  ],
};

describe("EstateTransferRecipientCard — distributionForm chip", () => {
  it("renders 'Outright' chip when set", () => {
    render(<EstateTransferRecipientCard group={baseGroup} />);
    expect(screen.getByText(/^outright$/i)).toBeInTheDocument();
  });

  it("renders 'In trust' chip when set", () => {
    const g = {
      ...baseGroup,
      byMechanism: [
        {
          ...baseGroup.byMechanism[0],
          assets: [
            { ...baseGroup.byMechanism[0].assets[0], distributionForm: "in_trust" as const },
          ],
        },
      ],
    };
    render(<EstateTransferRecipientCard group={g} />);
    expect(screen.getByText(/^in trust$/i)).toBeInTheDocument();
  });

  it("omits the chip when distributionForm is absent", () => {
    const g = {
      ...baseGroup,
      byMechanism: [
        {
          ...baseGroup.byMechanism[0],
          assets: [
            { ...baseGroup.byMechanism[0].assets[0], distributionForm: undefined },
          ],
        },
      ],
    };
    render(<EstateTransferRecipientCard group={g} />);
    expect(screen.queryByText(/^outright$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^in trust$/i)).not.toBeInTheDocument();
  });
});
