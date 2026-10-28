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
        grantor="client"
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
        grantor="client"
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
          entityId: null,
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
        grantor="client"
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
          entityId: null,
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
        grantor="client"
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
          entityId: null,
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

  it("auto-derives name to the estate-wide label when assetMode is residual", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        grantor="client"
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
          entityId: null,
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
        name: "Estate (what's left at this point)",
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
        grantor="client"
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
          entityId: null,
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

  it("defaults the first recipient to the co-client on Add when household has a co-client", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        grantor="client"
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

  it("hides the Condition section when no co-client is on file", () => {
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        grantor="client"
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
        grantor="client"
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
          entityId: null,
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
        grantor="client"
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
        grantor="client"
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

  it("selects a business entity from the picker and saves with entityId set and accountId null", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const bizEntity: WillsPanelEntity = { id: "biz-1", name: "Test Bus", entityType: "llc" };
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        grantor="client"
        primary={primary}
        accounts={[acct]}
        familyMembers={[fm]}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        businessEntities={[bizEntity]}
        onSave={onSave}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Asset or debt"), "entity:biz-1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "asset",
        entityId: "biz-1",
        accountId: null,
      }),
    );
  });

  it("disables Save in debt mode when recipient sum exceeds 100", async () => {
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        grantor="client"
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

describe("BequestDialog — Other Heirs", () => {
  it("saves a bequest to Other Heirs", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestDialog
        open
        onOpenChange={() => {}}
        grantor="client"
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
          entityId: null,
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
    await user.selectOptions(screen.getByRole("combobox", { name: /Recipient 1/i }), "other_heirs");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: [expect.objectContaining({ recipientKind: "other_heirs", recipientId: null, percentage: 100 })],
      }),
    );
  });
});

describe("BequestDialog — Dollar amount tab", () => {
  const cashAcct: WillsPanelAccount = { id: "a2", name: "Chase Savings", category: "cash", value: 50000 };
  const ira: WillsPanelAccount = { id: "a3", name: "Roth IRA", category: "retirement" };
  const trustAcct: WillsPanelAccount = {
    id: "a4",
    name: "ILIT Brokerage",
    category: "taxable",
    ownerEntityId: "t1",
  };
  const kids: WillsPanelFamilyMember[] = [
    { id: "k1", firstName: "Emma", lastName: null },
    { id: "k2", firstName: "Liam", lastName: null },
    { id: "k3", firstName: "Noah", lastName: null },
    { id: "k4", firstName: "Ava", lastName: null },
  ];

  function renderDialog(extra: Partial<React.ComponentProps<typeof BequestDialog>> = {}) {
    const onSave = vi.fn();
    const onGoToRemainder = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <BequestDialog
        open
        onOpenChange={onOpenChange}
        grantor="client"
        primary={primary}
        accounts={[acct, cashAcct, ira, trustAcct]}
        familyMembers={kids}
        externalBeneficiaries={[ext]}
        entities={[ent]}
        onSave={onSave}
        onGoToRemainder={onGoToRemainder}
        {...extra}
      />,
    );
    return { onSave, onGoToRemainder, onOpenChange };
  }

  async function pickRecipient(user: ReturnType<typeof userEvent.setup>, n: number, id: string) {
    await user.selectOptions(screen.getByRole("combobox", { name: `Recipient ${n}` }), `fm:${id}`);
  }

  it('saves "$20,000 to each grandchild" from the estate', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    await user.click(screen.getByRole("button", { name: "+ Add recipient" }));
    await user.click(screen.getByRole("button", { name: "+ Add recipient" }));
    await user.click(screen.getByRole("button", { name: "+ Add recipient" }));
    for (let i = 0; i < 4; i++) await pickRecipient(user, i + 1, kids[i].id);
    await user.type(screen.getByLabelText("Amount each"), "20000");
    expect(screen.getByText("Total $80,000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({
      kind: "dollar",
      name: "Cash gift",
      dollarSource: "estate",
      accountId: null,
      fallbackToEstate: false,
    });
    expect(saved.recipients).toHaveLength(4);
    expect(saved.recipients.map((r: { amount: number }) => r.amount)).toEqual([20000, 20000, 20000, 20000]);
    expect(saved.recipients.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("offers only cash and brokerage accounts with no entity owner, after the estate option", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    const options = Array.from(
      screen.getByLabelText("Paid from").querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(options).toEqual([
      "Estate — cash & brokerage",
      "Brokerage A",
      "Chase Savings — $50,000",
    ]);
  });

  it("shows the fallback checkbox only for a named account", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    const label = "If this account runs out or is deleted, pay the rest from any cash or brokerage";
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Paid from"), "account:a2");
    expect(screen.getByLabelText(label)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Paid from"), "estate");
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  });

  it("saves a named account with the fallback on", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    await user.selectOptions(screen.getByLabelText("Paid from"), "account:a2");
    await user.click(
      screen.getByLabelText("If this account runs out or is deleted, pay the rest from any cash or brokerage"),
    );
    await pickRecipient(user, 1, "k1");
    await user.type(screen.getByLabelText("Amount each"), "500");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dollarSource: "account", accountId: "a2", fallbackToEstate: true }),
    );
  });

  it("switching tabs drops the other kind's fields", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();
    // Start on Percentage, pick an account, then go to Dollar and back.
    await user.selectOptions(screen.getByLabelText("Asset or debt"), "asset:a1");
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    await pickRecipient(user, 1, "k1");
    await user.type(screen.getByLabelText("Amount each"), "100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const dollar = onSave.mock.calls[0][0];
    expect(dollar.kind).toBe("dollar");
    expect(dollar).not.toHaveProperty("assetMode");
    expect(dollar).not.toHaveProperty("entityId");
    expect(dollar).not.toHaveProperty("liabilityId");
    expect(dollar).not.toHaveProperty("percentage");
    expect(dollar.accountId).toBeNull();
    expect(dollar.recipients[0]).not.toHaveProperty("percentage");

    // And back: the percentage tab starts empty — the account pick did not survive.
    await user.click(screen.getByRole("button", { name: "Percentage" }));
    expect(screen.getByLabelText("Asset or debt")).not.toHaveValue("asset:a1");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the condition when switching tabs", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();
    await user.click(screen.getByRole("button", { name: "If Co-client survives" }));
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    await pickRecipient(user, 1, "k1");
    await user.type(screen.getByLabelText("Amount each"), "100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "dollar", condition: "if_spouse_survives" }),
    );
  });

  it.each([["blank", ""], ["zero", "0"], ["non-numeric", "abc"]])(
    "disables Save for a %s amount",
    async (_name, text) => {
      const user = userEvent.setup();
      const { onSave } = renderDialog();
      await user.click(screen.getByRole("button", { name: "Dollar amount" }));
      await pickRecipient(user, 1, "k1");
      const each = screen.getByLabelText("Amount each");
      await user.clear(each);
      if (text) await user.type(each, text);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.getByText("Total $0")).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it("disables Save until a recipient is picked", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    await user.type(screen.getByLabelText("Amount each"), "100");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await pickRecipient(user, 1, "k1");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("opens an existing dollar gift on the Dollar tab with Same amount off when amounts differ", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({
      editing: {
        kind: "dollar",
        name: "Cash gift",
        dollarSource: "estate",
        accountId: null,
        fallbackToEstate: false,
        condition: "always",
        sortOrder: 2,
        recipients: [
          { recipientKind: "family_member", recipientId: "k1", amount: 15000, sortOrder: 0 },
          { recipientKind: "family_member", recipientId: "k2", amount: 5000, sortOrder: 1 },
        ],
      },
    });
    expect(screen.getByRole("button", { name: "Dollar amount" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Same amount to each")).not.toBeChecked();
    expect(screen.getByLabelText("Amount 1")).toHaveValue("15000");
    expect(screen.getByLabelText("Amount 2")).toHaveValue("5000");
    expect(screen.getByText("Total $20,000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "dollar",
        sortOrder: 2,
        recipients: [
          expect.objectContaining({ recipientId: "k1", amount: 15000 }),
          expect.objectContaining({ recipientId: "k2", amount: 5000 }),
        ],
      }),
    );
  });

  it("opens an existing equal-amount gift with Same amount on and one field", () => {
    renderDialog({
      editing: {
        kind: "dollar",
        name: "Cash gift",
        dollarSource: "estate",
        accountId: null,
        fallbackToEstate: false,
        condition: "always",
        sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "k1", amount: 20000, sortOrder: 0 },
          { recipientKind: "family_member", recipientId: "k2", amount: 20000, sortOrder: 1 },
        ],
      },
    });
    expect(screen.getByLabelText("Same amount to each")).toBeChecked();
    expect(screen.getByLabelText("Amount each")).toHaveValue("20000");
    expect(screen.queryByLabelText("Amount 1")).not.toBeInTheDocument();
  });

  it("turning Same amount off lets each row carry its own amount", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    await user.click(screen.getByRole("button", { name: "+ Add recipient" }));
    await pickRecipient(user, 1, "k1");
    await pickRecipient(user, 2, "k2");
    await user.type(screen.getByLabelText("Amount each"), "1000");
    await user.click(screen.getByLabelText("Same amount to each"));
    const second = screen.getByLabelText("Amount 2");
    await user.clear(second);
    await user.type(second, "250");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0].recipients.map((r: { amount: number }) => r.amount)).toEqual([1000, 250]);
  });

  it("shows a disabled '(account removed)' option for a gift whose account is gone", () => {
    renderDialog({
      editing: {
        kind: "dollar",
        name: "Cash gift",
        dollarSource: "account",
        accountId: null,
        fallbackToEstate: false,
        condition: "always",
        sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "k1", amount: 100, sortOrder: 0 }],
      },
    });
    const opt = screen.getByRole("option", { name: "(account removed)" }) as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
    expect(screen.getByLabelText("Paid from")).toHaveValue("__removed__");
    // No source yet, so Save is off.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("Remaining estate tab calls onGoToRemainder and closes", async () => {
    const user = userEvent.setup();
    const { onGoToRemainder, onOpenChange } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Remaining estate" }));
    expect(
      screen.getByText(
        "The remainder estate gets whatever is left after every gift on this list. Set it in the Remainder estate section of the will.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Go to Remainder estate" }));
    expect(onGoToRemainder).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("labels the percentage helper text and estate option with the new copy", () => {
    renderDialog();
    expect(screen.getByText("Of whatever is left after the gifts above this one.")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Estate (what's left at this point)" }),
    ).toBeInTheDocument();
  });
});
