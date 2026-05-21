// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import AssetPickerModal from "../asset-picker-modal";
import type { PickerBusiness } from "../asset-picker-modal";

const TRUST_ID = "trust-abc";

describe("AssetPickerModal — Businesses section", () => {
  it("renders an unassigned business under 'Business Entities' when the trust does not own it yet", () => {
    const businesses: PickerBusiness[] = [
      {
        id: "biz-1",
        name: "Acme LLC",
        owners: [
          { kind: "family_member", familyMemberId: "fm-c", percent: 1.0 },
        ],
      },
    ];
    render(
      <AssetPickerModal
        entityId={TRUST_ID}
        accounts={[]}
        liabilities={[]}
        businesses={businesses}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    expect(screen.getByText("Business Entities")).toBeInTheDocument();
    expect(screen.getByText("Acme LLC")).toBeInTheDocument();
    expect(screen.getByText(/unassigned/i)).toBeInTheDocument();
  });

  it("hides businesses that are already 100% owned by this trust", () => {
    const businesses: PickerBusiness[] = [
      {
        id: "biz-full",
        name: "Already In Trust",
        owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1.0 }],
      },
      {
        id: "biz-partial",
        name: "Partially Owned",
        owners: [
          { kind: "entity", entityId: TRUST_ID, percent: 0.4 },
          { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
        ],
      },
    ];
    render(
      <AssetPickerModal
        entityId={TRUST_ID}
        accounts={[]}
        liabilities={[]}
        businesses={businesses}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    expect(screen.queryByText("Already In Trust")).not.toBeInTheDocument();
    expect(screen.getByText("Partially Owned")).toBeInTheDocument();
    // Shows the 40% partial ownership label
    expect(screen.getByText(/40% owned/i)).toBeInTheDocument();
  });

  it("emits onAdd with assetType=entity when a business is picked at 100%", () => {
    const onAdd = vi.fn();
    const businesses: PickerBusiness[] = [
      {
        id: "biz-1",
        name: "Acme LLC",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetPickerModal
        entityId={TRUST_ID}
        accounts={[]}
        liabilities={[]}
        businesses={businesses}
        onClose={vi.fn()}
        onAdd={onAdd}
      />
    );
    fireEvent.click(screen.getByLabelText("Select Acme LLC"));
    fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "add",
        assetType: "entity",
        assetId: "biz-1",
        percent: 100,
      })
    );
  });

  it("shows the empty-state when accounts + liabilities + businesses are all empty", () => {
    render(
      <AssetPickerModal
        entityId={TRUST_ID}
        accounts={[]}
        liabilities={[]}
        businesses={[]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    expect(
      screen.getByText(/All household assets are already fully assigned to this trust/i)
    ).toBeInTheDocument();
  });

  it("does not show the empty-state if only businesses are available", () => {
    const businesses: PickerBusiness[] = [
      {
        id: "biz-1",
        name: "Acme LLC",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetPickerModal
        entityId={TRUST_ID}
        accounts={[]}
        liabilities={[]}
        businesses={businesses}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />
    );
    expect(
      screen.queryByText(/All household assets are already fully assigned to this trust/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText("Acme LLC")).toBeInTheDocument();
  });
});
