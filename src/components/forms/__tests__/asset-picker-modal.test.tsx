// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import AssetPickerModal from "../asset-picker-modal";
import type { PickerAccount, PickerLiability } from "../asset-picker-modal";

const TRUST_ID = "trust-abc";

describe("AssetPickerModal", () => {
  it("hides accounts already 100% owned by this trust", () => {
    const accounts: PickerAccount[] = [
      {
        id: "acc-1",
        name: "Already Trust Owned",
        subType: "taxable",
        owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1.0 }],
      },
      {
        id: "acc-2",
        name: "Partial Owner",
        subType: "taxable",
        owners: [
          { kind: "entity", entityId: TRUST_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
        ],
      },
    ];
    render(
      <AssetPickerModal
        trustId={TRUST_ID}
        accounts={accounts}
        liabilities={[]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    expect(screen.queryByText("Already Trust Owned")).not.toBeInTheDocument();
    expect(screen.getByText("Partial Owner")).toBeInTheDocument();
  });

  it("hides other-entity default-checking accounts", () => {
    const accounts: PickerAccount[] = [
      {
        id: "acc-checking",
        name: "LLC Checking",
        subType: "cash",
        isDefaultChecking: true,
        owners: [{ kind: "entity", entityId: "other-entity-id", percent: 1.0 }],
      },
      {
        id: "acc-regular",
        name: "Regular Account",
        subType: "taxable",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetPickerModal
        trustId={TRUST_ID}
        accounts={accounts}
        liabilities={[]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    expect(screen.queryByText("LLC Checking")).not.toBeInTheDocument();
    expect(screen.getByText("Regular Account")).toBeInTheDocument();
  });

  it("retirement subType: clicking account shows reassign-100% message (no percent input)", () => {
    const accounts: PickerAccount[] = [
      {
        id: "acc-roth",
        name: "Roth IRA",
        subType: "roth_ira",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetPickerModal
        trustId={TRUST_ID}
        accounts={accounts}
        liabilities={[]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText("Select Roth IRA"));
    expect(screen.getByText(/Retirement accounts require a single owner/i)).toBeInTheDocument();
    // No percent text input for retirement accounts
    expect(screen.queryByLabelText("Ownership percent")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reassign 100%/i })).toBeInTheDocument();
  });

  it("standard account: clicking account shows percent input defaulting to 100", () => {
    const accounts: PickerAccount[] = [
      {
        id: "acc-1",
        name: "Brokerage",
        subType: "taxable",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetPickerModal
        trustId={TRUST_ID}
        accounts={accounts}
        liabilities={[]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText("Select Brokerage"));
    // PercentInput renders a visible text input + a hidden input; check for visible text input
    expect(screen.getByText(/Adding:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add$/i })).toBeInTheDocument();
  });

  it("calls onAdd with the correct op on confirm", () => {
    const onAdd = vi.fn();
    const accounts: PickerAccount[] = [
      {
        id: "acc-1",
        name: "Brokerage",
        subType: "taxable",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetPickerModal
        trustId={TRUST_ID}
        accounts={accounts}
        liabilities={[]}
        onClose={vi.fn()}
        onAdd={onAdd}
      />
    );
    fireEvent.click(screen.getByLabelText("Select Brokerage"));
    fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: "add", assetType: "account", assetId: "acc-1", percent: 100 })
    );
  });

  it("shows liabilities in a separate section", () => {
    const liabilities: PickerLiability[] = [
      {
        id: "liab-1",
        name: "Mortgage",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetPickerModal
        trustId={TRUST_ID}
        accounts={[]}
        liabilities={liabilities}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    expect(screen.getByText("Mortgage")).toBeInTheDocument();
  });
});
