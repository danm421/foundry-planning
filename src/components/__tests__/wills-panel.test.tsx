// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// WillsPanel calls useScenarioWriter → useScenarioState → useRouter, all of
// which require an app-router context. Stub the whole module so the panel can
// mount in jsdom.
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/details/wills",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import WillsPanel, {
  type WillsPanelDollarBequest,
  type WillsPanelLiabilityBequest,
} from "../wills-panel";

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
                name: "Brokerage to Co-client",
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
    expect(screen.getByText("Brokerage to Co-client")).toBeDefined();
    expect(screen.getByText(/Fidelity Brokerage/)).toBeDefined();
    expect(screen.getAllByText(/100%/).length).toBeGreaterThanOrEqual(1);
    // Exact match for the bequest condition badge — avoids colliding with the
    // residuary section's "Primary — if Co-client survives" tier label.
    expect(screen.getByText("If Co-client survives")).toBeDefined();
  });

  it("hides the co-client section when spouseName is null", () => {
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
    expect(screen.getByLabelText(/^Asset or debt$/i)).toBeDefined();
    expect(screen.getByLabelText(/^Percentage$/i)).toBeDefined();
    // Name field is gone — auto-derived from the chosen target on save.
    expect(screen.queryByLabelText(/^Name$/i)).toBeNull();
  });

  it("enables Save once an account is picked (default co-client recipient is at 100%)", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    const save = screen.getByRole("button", { name: /^Save$/i });
    expect((save as HTMLButtonElement).disabled).toBe(true); // accountId null (assetMode 'specific')
    fireEvent.change(screen.getByLabelText(/^Asset or debt$/i), {
      target: { value: `asset:${u("a1")}` },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false); // account picked, spouse default at 100%
  });

  it("disables Save when recipient percentages drift from 100", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    fireEvent.change(screen.getByLabelText(/^Asset or debt$/i), {
      target: { value: `asset:${u("a1")}` },
    });
    const pctInputs = screen.getAllByRole("spinbutton");
    // Recipient percentage input is the second spinbutton (first is bequest-percentage).
    fireEvent.change(pctInputs[1], { target: { value: "50" } });
    const save = screen.getByRole("button", { name: /^Save$/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});

const pctGift = (id: string, sortOrder: number, accountId: string) => ({
  kind: "asset" as const,
  id: u(id),
  name: `60% gift ${id}`,
  assetMode: "specific" as const,
  accountId,
  percentage: 60,
  condition: "always" as const,
  sortOrder,
  recipients: [
    {
      id: u(`r${id}`),
      recipientKind: "family_member" as const,
      recipientId: u("f1"),
      percentage: 100,
      sortOrder: 0,
    },
  ],
});

describe("WillsPanel — same-account hint", () => {
  it("shows the same-account hint instead of the over-allocation warning", () => {
    render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [pctGift("b1", 0, u("a1")), pctGift("b2", 1, u("a1"))],
          },
        ]}
      />,
    );
    expect(screen.queryByText(/Allocation warnings/i)).toBeNull();
    expect(screen.queryByText(/over-allocated/i)).toBeNull();
    expect(
      screen.getByText(
        "Fidelity Brokerage appears in more than one gift. Each later gift takes its percentage of what's left — to split it, use one gift with several recipients.",
      ),
    ).toBeDefined();
  });

  it("shows no hint when each account is named once", () => {
    render(
      <WillsPanel
        {...baseProps}
        accounts={[...baseProps.accounts, { id: u("a2"), name: "Chase Savings", category: "cash" as const }]}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [pctGift("b1", 0, u("a1")), pctGift("b2", 1, u("a2"))],
          },
        ]}
      />,
    );
    expect(screen.queryByText(/appears in more than one gift/)).toBeNull();
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

describe("WillsPanel — debt bequests in the unified list", () => {
  it("renders a full-debt-bequest row without the remainder caption", () => {
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

  it("tags debt bequests with a 'Debt' label in the unified list", () => {
    render(
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
    expect(screen.getAllByText(/^Debt$/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a partial-debt-bequest row with the remainder caption", () => {
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

  it("flips into debt mode when a liability is selected and restricts the recipient picker", () => {
    const propsWithExternals = {
      ...baseProps,
      externalBeneficiaries: [{ id: u("ext1"), name: "Red Cross" }],
      entities: [{ id: u("ent1"), name: "Family ILIT" }],
    };
    render(<WillsPanel {...propsWithExternals} initialWills={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    fireEvent.change(screen.getByLabelText(/^Asset or debt$/i), {
      target: { value: `debt:${u("l1")}` },
    });

    const dialog = screen.getByRole("dialog");
    const recipientSelect = within(dialog).getByRole("combobox", { name: /Recipient 1/i });
    const optgroupLabels = Array.from(recipientSelect.querySelectorAll("optgroup")).map(
      (g) => (g as HTMLOptGroupElement).label,
    );
    expect(optgroupLabels).toContain("Family");
    expect(optgroupLabels).toContain("Entity");
    expect(optgroupLabels).not.toContain("Household");
    expect(optgroupLabels).not.toContain("External");
  });

  it("dropdown excludes liabilities with linkedPropertyId or ownerEntityId set", () => {
    // baseProps has: l1=Visa Card (unlinked, eligible), l2=Mortgage (linkedPropertyId set)
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);

    const dialog = screen.getByRole("dialog");
    const select = within(dialog).getByLabelText(/^Asset or debt$/i);
    const values = Array.from(select.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );

    expect(values).toContain(`debt:${u("l1")}`); // Visa Card — eligible
    expect(values).not.toContain(`debt:${u("l2")}`); // Mortgage — linked, ineligible
  });

  it("dropdown disables liabilities already bequeathed in this will", () => {
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
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);

    const dialog = screen.getByRole("dialog");
    const select = within(dialog).getByLabelText(/^Asset or debt$/i);
    const visaOption = Array.from(select.querySelectorAll("option")).find(
      (o) => (o as HTMLOptionElement).value === `debt:${u("l1")}`,
    ) as HTMLOptionElement | undefined;

    expect(visaOption).toBeDefined();
    expect(visaOption!.disabled).toBe(true);
  });

  it("renders the Remainder estate section per grantor", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    expect(screen.getAllByText(/Remainder estate/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/No remainder clause specified/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders a populated residuary clause from initialWills", () => {
    render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [],
            residuaryRecipients: [
              {
                recipientKind: "spouse",
                recipientId: null,
                percentage: 100,
                sortOrder: 0,
              },
            ],
          },
        ]}
      />,
    );
    // No "no remainder" copy when one is configured
    const empties = screen.queryAllByText(/No remainder clause specified/i);
    // Spouse-grantor (no will) still shows the empty state; client-grantor should NOT
    expect(empties.length).toBe(1);
    // Spouse option appears as a recipient row
    const recipientSelects = screen.getAllByRole("combobox", { name: /Recipient 1/i });
    expect(recipientSelects.length).toBeGreaterThan(0);
  });
});

describe("WillsPanel — Other Heirs", () => {
  it('labels an Other Heirs recipient "Other Heirs"', () => {
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
                name: "Brokerage to Other Heirs",
                assetMode: "specific" as const,
                accountId: u("a1"),
                percentage: 100,
                condition: "always" as const,
                sortOrder: 0,
                recipients: [
                  { id: u("r1"), recipientKind: "other_heirs" as const, recipientId: null, percentage: 100, sortOrder: 0 },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText(/Other Heirs \(100%\)/)).toBeDefined();
    expect(screen.queryByText(/\(entity\)/)).toBeNull();
  });
});

// ─── Dollar gifts ─────────────────────────────────────────────────────────────

const giftRows = () => Array.from(document.querySelectorAll<HTMLElement>("ol > li"));

const kids = [
  { id: u("k1"), firstName: "Emma", lastName: null },
  { id: u("k2"), firstName: "Liam", lastName: null },
];
// No co-client: one will section, so lists and copy are unique on the page.
const dollarProps = {
  ...baseProps,
  primary: { ...baseProps.primary, spouseName: null, spouseLastName: null },
  familyMembers: [...baseProps.familyMembers, ...kids],
};

const dollarGift = (over: Partial<WillsPanelDollarBequest> = {}): WillsPanelDollarBequest => ({
  kind: "dollar",
  id: u("d1"),
  name: "Cash gift",
  dollarSource: "estate",
  accountId: null,
  fallbackToEstate: false,
  condition: "always",
  sortOrder: 0,
  recipients: [
    { recipientKind: "family_member", recipientId: u("k1"), amount: 20000, percentage: 0, sortOrder: 0 },
    { recipientKind: "family_member", recipientId: u("k2"), amount: 20000, percentage: 0, sortOrder: 1 },
  ],
  ...over,
});

const willWith = (bequests: WillsPanelDollarBequest[] | ReturnType<typeof pctGift>[] | unknown[]) => [
  { id: u("w1"), grantor: "client" as const, bequests: bequests as never },
];

describe("WillsPanel — dollar gifts in the list", () => {
  it('renders a dollar gift as "$20,000 each · from cash & brokerage"', () => {
    render(<WillsPanel {...dollarProps} initialWills={willWith([dollarGift()])} />);
    expect(screen.getByText("$20,000 each · from cash & brokerage")).toBeDefined();
    expect(screen.getByText("Cash")).toBeDefined();
    expect(screen.getByText("Emma ($20,000), Liam ($20,000)")).toBeDefined();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("reads unequal amounts as a total, with a named account and the fallback", () => {
    render(
      <WillsPanel
        {...dollarProps}
        initialWills={willWith([
          dollarGift({
            dollarSource: "account",
            accountId: u("a1"),
            fallbackToEstate: true,
            recipients: [
              { recipientKind: "family_member", recipientId: u("k1"), amount: 15000, percentage: 0, sortOrder: 0 },
              { recipientKind: "family_member", recipientId: u("k2"), amount: 5000, percentage: 0, sortOrder: 1 },
            ],
          }),
        ])}
      />,
    );
    expect(
      screen.getByText("$20,000 total · from Fidelity Brokerage (then any cash)"),
    ).toBeDefined();
    expect(screen.getByText("Emma ($15,000), Liam ($5,000)")).toBeDefined();
  });

  it("flags a removed account", () => {
    render(
      <WillsPanel
        {...dollarProps}
        initialWills={willWith([
          dollarGift({ dollarSource: "account", accountId: null }),
          dollarGift({
            id: u("d2"),
            sortOrder: 1,
            dollarSource: "account",
            accountId: null,
            fallbackToEstate: true,
          }),
        ])}
      />,
    );
    expect(
      screen.getByText("$20,000 each · account removed — pays nothing until you pick a source"),
    ).toBeDefined();
    expect(screen.getByText("$20,000 each · account removed — paid from cash & brokerage")).toBeDefined();
  });

  it("numbers the gifts in payment order and explains the order; a debt isn't paid in that order, so it has no number", () => {
    render(
      <WillsPanel
        {...dollarProps}
        initialWills={willWith([
          pctGift("b1", 0, u("a1")),
          { ...liabilityBequestFull, sortOrder: 1 },
          dollarGift({ sortOrder: 2 }),
          dollarGift({ id: u("d2"), sortOrder: 3 }),
        ])}
      />,
    );
    expect(
      screen.getByText("Gifts are paid top to bottom; the remainder estate gets what's left."),
    ).toBeDefined();
    const rows = giftRows();
    expect(rows).toHaveLength(4);
    const numberOf = (row: HTMLElement) => within(row).queryByText(/^\d+$/)?.textContent ?? null;
    expect(rows.map(numberOf)).toEqual(["1", null, "2", "3"]);
    expect(within(rows[0]).getByText("60% gift b1")).toBeDefined();
    expect(within(rows[1]).getByText("Visa Card")).toBeDefined();
    expect(within(rows[2]).getByText("Cash gift")).toBeDefined();
  });

  it("labels an all-assets gift with the estate-wide label", () => {
    render(
      <WillsPanel
        {...dollarProps}
        initialWills={willWith([{ ...pctGift("b1", 0, u("a1")), assetMode: "all_assets", accountId: null }])}
      />,
    );
    expect(screen.getByText("60% of Estate (what's left at this point)")).toBeDefined();
  });
});

describe("WillsPanel — saving with dollar gifts", () => {
  const fetchMock = vi.fn();
  const patchBodies = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(init.body as string));

  beforeEach(() => {
    nav.search = "";
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return { ok: true, status: 200, json: async () => ({}) };
      return { ok: false, status: 404, json: async () => ({}) }; // hydrate GET falls back to local state
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    nav.search = "";
  });

  it("round-trips a dollar gift through edit and save", async () => {
    const user = userEvent.setup();
    render(
      <WillsPanel {...dollarProps} initialWills={willWith([pctGift("b1", 0, u("a1")), dollarGift({ sortOrder: 1 })])} />,
    );
    const rows = giftRows();
    await user.click(within(rows[1]).getByRole("button", { name: "Edit bequest" }));
    expect(screen.getByRole("button", { name: "Dollar amount" })).toHaveAttribute("aria-pressed", "true");
    const each = screen.getByLabelText("Amount each");
    await user.clear(each);
    await user.type(each, "25000");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    const [body] = patchBodies();
    expect(body.bequests).toHaveLength(2);
    expect(body.bequests[0]).toMatchObject({ kind: "asset", sortOrder: 0 });
    expect(body.bequests[1]).toMatchObject({
      kind: "dollar",
      name: "Cash gift",
      dollarSource: "estate",
      accountId: null,
      fallbackToEstate: false,
      sortOrder: 1,
    });
    expect(body.bequests[1].recipients.map((r: { amount: number }) => r.amount)).toEqual([25000, 25000]);
  });

  it("moving a dollar gift keeps its dollar fields", async () => {
    const user = userEvent.setup();
    render(
      <WillsPanel
        {...dollarProps}
        initialWills={willWith([
          pctGift("b1", 0, u("a1")),
          dollarGift({ sortOrder: 1, dollarSource: "account", accountId: u("a1"), fallbackToEstate: true }),
        ])}
      />,
    );
    const rows = giftRows();
    await user.click(within(rows[1]).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    const [body] = patchBodies();
    expect(body.bequests[0]).toMatchObject({
      kind: "dollar",
      dollarSource: "account",
      accountId: u("a1"),
      fallbackToEstate: true,
      sortOrder: 0,
    });
    expect(body.bequests[0].recipients[0].amount).toBe(20000);
    expect(body.bequests[1]).toMatchObject({ kind: "asset", sortOrder: 1 });
  });

  it("says a refused dollar-gift source in plain words, not its code", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? { ok: false, status: 400, json: async () => ({ error: "dollar_bequest_source_entity_owned", detail: u("a1") }) }
        : { ok: false, status: 404, json: async () => ({}) },
    );
    const user = userEvent.setup();
    render(<WillsPanel {...dollarProps} initialWills={willWith([pctGift("b1", 0, u("a1")), dollarGift({ sortOrder: 1 })])} />);
    await user.click(within(giftRows()[0]).getByRole("button", { name: "Move down" }));
    expect(
      await screen.findByText(
        "A trust or business owns that account, so the will can't pay a gift from it. Pick a cash or brokerage account owned by the client.",
      ),
    ).toBeDefined();
    expect(screen.queryByText(/dollar_bequest_source/)).toBeNull();
  });

  it("renumbers a gappy list to 0..n-1 when a gift is added", async () => {
    const user = userEvent.setup();
    render(
      <WillsPanel
        {...dollarProps}
        initialWills={willWith([pctGift("b1", 0, u("a1")), dollarGift({ sortOrder: 2 })])}
      />,
    );
    await user.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    await user.click(screen.getByRole("button", { name: "Dollar amount" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Recipient 1" }), `fm:${u("k1")}`);
    await user.type(screen.getByLabelText("Amount each"), "100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    const [body] = patchBodies();
    expect(body.bequests.map((b: { sortOrder: number }) => b.sortOrder)).toEqual([0, 1, 2]);
    expect(body.bequests[2]).toMatchObject({ kind: "dollar" });
  });

  it("sends dollar fields unchanged through the scenario writer", async () => {
    nav.search = "scenario=s1";
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const user = userEvent.setup();
    render(
      <WillsPanel
        {...dollarProps}
        initialWills={willWith([
          dollarGift({ dollarSource: "account", accountId: u("a1"), fallbackToEstate: true }),
        ])}
      />,
    );
    const row = giftRows()[0];
    await user.click(within(row).getByRole("button", { name: "Edit bequest" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/scenarios/s1/changes"));
    expect(call).toBeDefined();
    const sent = JSON.parse(call![1].body as string);
    expect(sent.desiredFields.bequests[0]).toMatchObject({
      kind: "dollar",
      dollarSource: "account",
      accountId: u("a1"),
      fallbackToEstate: true,
      sortOrder: 0,
    });
    expect(sent.desiredFields.bequests[0].recipients[0]).toMatchObject({ amount: 20000 });
  });

  it("Go to Remainder estate scrolls the will's remainder section into view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    render(<WillsPanel {...dollarProps} initialWills={willWith([dollarGift()])} />);
    await user.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    await user.click(screen.getByRole("button", { name: "Remaining estate" }));
    await user.click(screen.getByRole("button", { name: "Go to Remainder estate" }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const target = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(target.id).toBe("will-remainder-client");
  });
});
