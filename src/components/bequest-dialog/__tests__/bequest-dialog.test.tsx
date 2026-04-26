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
  WillsPanelPrimary,
} from "@/components/wills-panel";

const acct: WillsPanelAccount = { id: "a1", name: "Brokerage A", category: "taxable" };
const fm: WillsPanelFamilyMember = { id: "f1", firstName: "Tom", lastName: "Jr" };
const ext: WillsPanelExternal = { id: "e1", name: "Red Cross" };
const ent: WillsPanelEntity = { id: "t1", name: "Family ILIT" };
const primary: WillsPanelPrimary = {
  firstName: "Cooper",
  lastName: "Smith",
  spouseName: "Sarah",
  spouseLastName: "Smith",
};
const noSpouse: WillsPanelPrimary = {
  firstName: "Cooper",
  lastName: "Smith",
  spouseName: null,
  spouseLastName: null,
};

describe("BequestDialog", () => {
  it("renders 'New bequest' when no editing prop is passed", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: /new bequest/i })).toBeInTheDocument();
  });

  it("renders 'Edit bequest' when editing prop is passed", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
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
  });

  it("disables Save when recipient percentages do not sum to 100", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
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

  it("invokes onSave with auto-derived name when Save is clicked", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        editing={{
          name: "ignored",
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
        // Name auto-derived from the chosen asset, not "ignored"
        name: "Brokerage A",
        assetMode: "specific",
        accountId: "a1",
        percentage: 100,
        condition: "always",
      }),
    );
  });

  it("auto-derives name to 'All other assets' when assetMode is residual", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        editing={{
          name: "ignored",
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
      expect.objectContaining({
        name: "All other assets",
        assetMode: "all_assets",
        accountId: null,
      }),
    );
  });

  it("disables Save when assetMode is 'specific' but accountId is null", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
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

  it("defaults the first recipient to spouse on Add when household has a spouse", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={onSave}
      />,
    );
    // Pick an account so canSave can flip
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

  it("hides the Condition section when no spouse is on file", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={noSpouse}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Condition/i)).not.toBeInTheDocument();
  });

  it("switches assetMode to 'all_assets' and clears accountId when '__residual__' is selected", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
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

  it("recipient picker shows real names in the optgroup, not category labels", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={vi.fn()}
      />,
    );
    const recipientSelect = screen.getByRole("combobox", { name: /Recipient 1/i });
    const optionLabels = Array.from(recipientSelect.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).textContent ?? "",
    );
    // Real names visible
    expect(optionLabels.some((l) => l.includes("Sarah"))).toBe(true);
    expect(optionLabels.some((l) => l.includes("Tom Jr"))).toBe(true);
    expect(optionLabels.some((l) => l.includes("Red Cross"))).toBe(true);
    expect(optionLabels.some((l) => l.includes("Family ILIT"))).toBe(true);
    // No bare category labels
    expect(optionLabels).not.toContain("Family member");
    expect(optionLabels).not.toContain("Entity / Trust");
  });
});
