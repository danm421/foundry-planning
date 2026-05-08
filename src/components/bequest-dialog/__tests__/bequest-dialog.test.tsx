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
  WillsPanelLiability,
  WillsPanelPrimary,
} from "@/components/wills-panel";

const acct: WillsPanelAccount = { id: "a1", name: "Brokerage A", category: "taxable" };
const fm: WillsPanelFamilyMember = { id: "f1", firstName: "Tom", lastName: "Jr" };
const ext: WillsPanelExternal = { id: "e1", name: "Red Cross" };
const ent: WillsPanelEntity = { id: "t1", name: "Family ILIT" };
const liab: WillsPanelLiability = {
  id: "l1",
  name: "Auto loan",
  balance: 12000,
  linkedPropertyId: null,
  ownerEntityId: null,
};
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
          kind: "asset",
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
          kind: "asset",
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
          kind: "asset",
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

  it("auto-derives name to 'Remaining Estate Value' when assetMode is residual", async () => {
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
          kind: "asset",
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
    await user.selectOptions(screen.getByLabelText("Asset or debt"), "__residual__");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Remaining Estate Value",
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
          kind: "asset",
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
    await user.selectOptions(screen.getByLabelText("Asset or debt"), "asset:a1");
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
          kind: "asset",
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
    await user.selectOptions(screen.getByLabelText("Asset or debt"), "__residual__");
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

  it("flips into debt mode when a liability is selected and saves a liability draft", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
        accounts={[acct]}
        liabilities={[liab]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={onSave}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Asset or debt"), "debt:l1");
    // Percentage and Condition inputs disappear in debt mode.
    expect(screen.queryByLabelText("Percentage")).not.toBeInTheDocument();
    expect(screen.queryByText(/Condition/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "liability",
        name: "Auto loan",
        liabilityId: "l1",
        percentage: 100,
        condition: "always",
      }),
    );
  });

  it("disables Save in debt mode when recipient sum exceeds 100", async () => {
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        primary={primary}
        accounts={[acct]}
        liabilities={[liab]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={vi.fn()}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Asset or debt"), "debt:l1");
    const pctInput = screen.getByLabelText("Percent 1");
    await user.clear(pctInput);
    await user.type(pctInput, "150");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
