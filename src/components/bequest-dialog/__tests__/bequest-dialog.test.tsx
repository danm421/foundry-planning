// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BequestDialog from "@/components/bequest-dialog";
import type {
  WillsPanelAccount,
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
} from "@/components/wills-panel";

const acct: WillsPanelAccount = { id: "a1", name: "Brokerage A", category: "taxable" };
const fm: WillsPanelFamilyMember = { id: "f1", firstName: "Tom", lastName: "Jr" };
const ext: WillsPanelExternal = { id: "e1", name: "Red Cross" };
const ent: WillsPanelEntity = { id: "t1", name: "Family ILIT" };

describe("BequestDialog", () => {
  it("renders 'New bequest' when no editing prop is passed", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: /new bequest/i })).toBeInTheDocument();
  });

  it("renders 'Edit bequest' and pre-fills when editing prop is passed", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        editing={{
          name: "To kids",
          assetMode: "specific",
          accountId: "a1",
          percentage: 50,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "family_member", recipientId: "f1", percentage: 100, sortOrder: 0 },
          ],
        }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: /edit bequest/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("To kids")).toBeInTheDocument();
  });

  it("disables Save when recipient percentages do not sum to 100", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        editing={{
          name: "Bad split",
          assetMode: "specific",
          accountId: "a1",
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "family_member", recipientId: "f1", percentage: 60, sortOrder: 0 },
          ],
        }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("invokes onSave with the assembled draft when Save is clicked", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        editing={{
          name: "All to Tom Jr",
          assetMode: "specific",
          accountId: "a1",
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "family_member", recipientId: "f1", percentage: 100, sortOrder: 0 },
          ],
        }}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "All to Tom Jr",
        assetMode: "specific",
        accountId: "a1",
        percentage: 100,
        condition: "always",
      }),
    );
  });

  it("disables Save when assetMode is 'specific' but accountId is null", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        editing={{
          name: "Missing account",
          assetMode: "specific",
          accountId: null,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "family_member", recipientId: "f1", percentage: 100, sortOrder: 0 },
          ],
        }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("defaults the first recipient to spouse on Add (no editing prop)", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={onSave}
      />,
    );
    // Type a name so canSave can flip to true
    await user.type(screen.getByDisplayValue(""), "Spouse default");
    // Pick an account (default emptyDraft has accountId=null with assetMode=specific)
    await user.selectOptions(screen.getByLabelText("Asset"), "a1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: [
          expect.objectContaining({ recipientKind: "spouse", recipientId: null, percentage: 100 }),
        ],
      }),
    );
  });

  it("switches assetMode to 'all_assets' and clears accountId when '__residual__' is selected", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        editing={{
          name: "Residual",
          assetMode: "specific",
          accountId: "a1",
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "family_member", recipientId: "f1", percentage: 100, sortOrder: 0 },
          ],
        }}
        onSave={onSave}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Asset"), "__residual__");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ assetMode: "all_assets", accountId: null }),
    );
  });
});
