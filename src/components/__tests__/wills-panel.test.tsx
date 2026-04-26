// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import WillsPanel, { type WillsPanelLiabilityBequest } from "../wills-panel";

const u = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;

const baseProps = {
  clientId: u("c"),
  primary: {
    firstName: "Tom",
    lastName: "Smith",
    spouseName: "Linda",
    spouseLastName: "Smith",
  },
  accounts: [
    { id: u("a1"), name: "Fidelity Brokerage", category: "taxable" as const },
  ],
  liabilities: [
    { id: u("l1"), name: "Visa Card", balance: 5000, linkedPropertyId: null, ownerEntityId: null },
    { id: u("l2"), name: "Mortgage", balance: 300000, linkedPropertyId: u("a1"), ownerEntityId: null },
  ],
  familyMembers: [
    { id: u("f1"), firstName: "Tom", lastName: "Jr" },
  ],
  externalBeneficiaries: [],
  entities: [],
};

describe("WillsPanel", () => {
  it("renders an empty state for a grantor with no will", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    expect(screen.getByText(/Tom Smith/)).toBeDefined();
    expect(screen.getByText(/Linda Smith/)).toBeDefined();
    expect(screen.getAllByText(/No bequests yet/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a will with one bequest", () => {
    render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [
              {
                kind: "asset" as const,
                id: u("b1"),
                name: "Brokerage to spouse",
                assetMode: "specific" as const,
                accountId: u("a1"),
                percentage: 100,
                condition: "if_spouse_survives" as const,
                sortOrder: 0,
                recipients: [
                  {
                    id: u("r1"),
                    recipientKind: "spouse" as const,
                    recipientId: null,
                    percentage: 100,
                    sortOrder: 0,
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("Brokerage to spouse")).toBeDefined();
    expect(screen.getByText(/Fidelity Brokerage/)).toBeDefined();
    expect(screen.getAllByText(/100%/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/If spouse survives/i)).toBeDefined();
  });

  it("hides the spouse section when spouseName is null", () => {
    render(
      <WillsPanel
        {...baseProps}
        primary={{ ...baseProps.primary, spouseName: null, spouseLastName: null }}
        initialWills={[]}
      />,
    );
    expect(screen.queryByText(/Linda Smith/)).toBeNull();
    expect(screen.getByText(/Tom Smith/)).toBeDefined();
  });
});

describe("WillsPanel — add bequest modal", () => {
  it("opens the modal when + Add bequest is clicked", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    const addButtons = screen.getAllByRole("button", { name: /Add bequest/i });
    fireEvent.click(addButtons[0]);
    expect(screen.getByText(/New bequest/i)).toBeDefined();
    expect(screen.getByLabelText(/^Asset$/i)).toBeDefined();
    expect(screen.getByLabelText(/^Percentage$/i)).toBeDefined();
    // Name field is gone — auto-derived from the chosen asset on save.
    expect(screen.queryByLabelText(/^Name$/i)).toBeNull();
  });

  it("enables Save once an account is picked (default spouse recipient is at 100%)", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    const save = screen.getByRole("button", { name: /^Save$/i });
    expect((save as HTMLButtonElement).disabled).toBe(true); // accountId null (assetMode 'specific')
    fireEvent.change(screen.getByLabelText(/^Asset$/i), { target: { value: u("a1") } });
    expect((save as HTMLButtonElement).disabled).toBe(false); // account picked, spouse default at 100%
  });

  it("disables Save when recipient percentages drift from 100", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    fireEvent.change(screen.getByLabelText(/^Asset$/i), { target: { value: u("a1") } });
    const pctInputs = screen.getAllByRole("spinbutton");
    // Recipient percentage input is the second spinbutton (first is bequest-percentage).
    fireEvent.change(pctInputs[1], { target: { value: "50" } });
    const save = screen.getByRole("button", { name: /^Save$/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("WillsPanel — soft warnings", () => {
  it("shows an allocation warning when an account is over-allocated at one condition", () => {
    render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [
              {
                kind: "asset" as const,
                id: u("b1"),
                name: "60% to child A",
                assetMode: "specific" as const,
                accountId: u("a1"),
                percentage: 60,
                condition: "always" as const,
                sortOrder: 0,
                recipients: [
                  {
                    id: u("r1"),
                    recipientKind: "family_member" as const,
                    recipientId: u("f1"),
                    percentage: 100,
                    sortOrder: 0,
                  },
                ],
              },
              {
                kind: "asset" as const,
                id: u("b2"),
                name: "60% to child A again",
                assetMode: "specific" as const,
                accountId: u("a1"),
                percentage: 60,
                condition: "always" as const,
                sortOrder: 1,
                recipients: [
                  {
                    id: u("r2"),
                    recipientKind: "family_member" as const,
                    recipientId: u("f1"),
                    percentage: 100,
                    sortOrder: 0,
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText(/Allocation warnings/i)).toBeDefined();
    expect(screen.getByText(/over-allocated/i)).toBeDefined();
    expect(screen.getByText(/120\.00%/)).toBeDefined();
  });
});

// ─── Debt bequests section ────────────────────────────────────────────────────

const liabilityBequestFull: WillsPanelLiabilityBequest = {
  kind: "liability",
  id: u("b10"),
  name: "Visa Card",
  liabilityId: u("l1"),
  percentage: 100,
  condition: "always",
  sortOrder: 0,
  recipients: [
    {
      id: u("r10"),
      recipientKind: "family_member",
      recipientId: u("f1"),
      percentage: 100,
      sortOrder: 0,
    },
  ],
};

const liabilityBequestPartial: WillsPanelLiabilityBequest = {
  kind: "liability",
  id: u("b11"),
  name: "Visa Card",
  liabilityId: u("l1"),
  percentage: 100,
  condition: "always",
  sortOrder: 0,
  recipients: [
    {
      id: u("r11"),
      recipientKind: "family_member",
      recipientId: u("f1"),
      percentage: 60,
      sortOrder: 0,
    },
  ],
};

describe("WillsPanel — Debt bequests section", () => {
  it("renders Debt bequests heading even when no liability bequests exist", () => {
    const { container } = render(
      <WillsPanel {...baseProps} initialWills={[]} />,
    );
    expect(container.textContent).toMatch(/Debt bequests/);
  });

  it("renders a full-bequest row without the remainder caption", () => {
    const { container } = render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [liabilityBequestFull],
          },
        ]}
      />,
    );
    expect(container.textContent).not.toMatch(/to estate creditor-payoff/);
    // Liability name and recipient visible
    expect(screen.getAllByText(/Visa Card/).length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toMatch(/Tom Jr/);
    expect(container.textContent).toMatch(/100%/);
  });

  it("renders a partial-bequest row with the remainder caption", () => {
    const { container } = render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [liabilityBequestPartial],
          },
        ]}
      />,
    );
    expect(container.textContent).toMatch(/40\.00% to estate creditor-payoff/);
  });

  it("add-debt-bequest dialog restricts recipient picker to family + entity (no spouse, no external)", () => {
    const propsWithExternals = {
      ...baseProps,
      externalBeneficiaries: [{ id: u("ext1"), name: "Red Cross" }],
      entities: [{ id: u("ent1"), name: "Family ILIT" }],
    };
    render(<WillsPanel {...propsWithExternals} initialWills={[]} />);
    // Click the first "+ Add debt bequest" button (Tom Smith's section)
    const addDebtButtons = screen.getAllByRole("button", { name: /Add debt bequest/i });
    fireEvent.click(addDebtButtons[0]);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();

    // Single combined recipient picker (matches BeneficiaryRowList pattern).
    const recipientSelect = within(dialog).getByRole("combobox", { name: /Recipient 1/i });
    const optgroupLabels = Array.from(recipientSelect.querySelectorAll("optgroup")).map(
      (g) => (g as HTMLOptGroupElement).label,
    );
    expect(optgroupLabels).toContain("Family");
    expect(optgroupLabels).toContain("Entity");
    expect(optgroupLabels).not.toContain("Household");
    expect(optgroupLabels).not.toContain("External");
  });

  it("liability picker excludes liabilities with linkedPropertyId or ownerEntityId set", () => {
    // baseProps has: l1=Visa Card (unlinked, eligible), l2=Mortgage (linkedPropertyId set)
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    const addDebtButtons = screen.getAllByRole("button", { name: /Add debt bequest/i });
    fireEvent.click(addDebtButtons[0]);

    const dialog = screen.getByRole("dialog");
    const liabilitySelect = within(dialog).getByRole("combobox", { name: /Liability/i });
    const options = Array.from(liabilitySelect.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );

    expect(options).toContain(u("l1")); // Visa Card — eligible
    expect(options).not.toContain(u("l2")); // Mortgage — linked, ineligible
  });

  it("liability picker disables liabilities already bequeathed in this will", () => {
    render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [liabilityBequestFull], // liabilityId = l1
          },
        ]}
      />,
    );
    const addDebtButtons = screen.getAllByRole("button", { name: /Add debt bequest/i });
    fireEvent.click(addDebtButtons[0]);

    const dialog = screen.getByRole("dialog");
    const liabilitySelect = within(dialog).getByRole("combobox", { name: /Liability/i });
    const visaOption = Array.from(liabilitySelect.querySelectorAll("option")).find(
      (o) => (o as HTMLOptionElement).value === u("l1"),
    ) as HTMLOptionElement | undefined;

    expect(visaOption).toBeDefined();
    expect(visaOption!.disabled).toBe(true);
  });
});
