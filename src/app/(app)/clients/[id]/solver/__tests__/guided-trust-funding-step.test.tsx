// @vitest-environment jsdom
//
// Wizard step 4 (funding), driven through a tiny stateful host so what's
// asserted is what the next render shows plus the last emitted items.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, ClientData } from "@/engine/types";
import { guidedTrustContext, type FundingItem } from "@/lib/solver/guided-trust";
import { GuidedTrustFundingStep } from "../guided-trust-funding-step";

const own = (id: string) => [{ kind: "family_member" as const, familyMemberId: id, percent: 1 }];

function acct(over: Partial<Account> & { id: string; name: string; category: Account["category"] }): Account {
  return { value: 100_000, owners: own("fm-c"), ...over } as unknown as Account;
}

function tree(married = true, wills: ClientData["wills"] = []): ClientData {
  return {
    client: {
      firstName: "Alex", lastName: "Rivera", dateOfBirth: "1968-05-01",
      ...(married ? { spouseName: "Jordan", spouseDob: "1970-03-02" } : {}),
    },
    accounts: [
      acct({ id: "a-brk", name: "Joint Brokerage", category: "taxable", value: 640_000 }),
      acct({ id: "a-ira", name: "Alex IRA", category: "retirement" }),
      acct({ id: "a-biz", name: "Rivera LLC", category: "business" }),
      acct({ id: "a-pol", name: "Term Policy", category: "life_insurance" }),
      acct({
        id: "a-pol-ent", name: "Trust Policy", category: "life_insurance",
        owners: [{ kind: "entity", entityId: "e-other", percent: 1 }],
      } as unknown as Partial<Account> & { id: string; name: string; category: Account["category"] }),
    ],
    planSettings: { planStartYear: 2026, planEndYear: 2030 },
    familyMembers: [
      { id: "fm-c", role: "client", relationship: "other", firstName: "Alex", lastName: "Rivera" },
      ...(married
        ? [{ id: "fm-s", role: "spouse", relationship: "other", firstName: "Jordan", lastName: "Rivera" }]
        : []),
    ],
    externalBeneficiaries: [],
    entities: [], incomes: [], expenses: [], savingsRules: [], liabilities: [], withdrawalStrategy: [],
    transfers: [], assetTransactions: [], giftEvents: [],
    wills,
  } as unknown as ClientData;
}

type Trust = Parameters<typeof GuidedTrustFundingStep>[0]["trust"];
const baseTrust: Trust = {
  id: "t1", name: "Rivera Trust", grantor: "client", crummeyPowers: true, kind: "irrevocable", crummeyHolders: 1,
};

function Host({
  trust = baseTrust, married = true, start = [], wills, onEmit,
}: {
  trust?: Trust; married?: boolean; start?: FundingItem[]; wills?: ClientData["wills"];
  onEmit?: (i: FundingItem[]) => void;
}) {
  const [items, setItems] = useState<FundingItem[]>(start);
  const ctx = guidedTrustContext(tree(married, wills), { 2026: 19000 });
  return (
    <GuidedTrustFundingStep
      trust={trust}
      items={items}
      ctx={ctx}
      onItemsChange={(n) => { setItems(n); onEmit?.(n); }}
    />
  );
}

const tile = (name: string) => screen.getByRole("radio", { name });

describe("GuidedTrustFundingStep", () => {
  it("adds a $1,000,000 cash gift aimed at the trust and shows the exemption line", async () => {
    const user = userEvent.setup();
    let last: FundingItem[] = [];
    render(<Host onEmit={(i) => (last = i)} />);
    await user.type(screen.getByLabelText(/amount/i, { selector: "input" }), "1000000");
    expect(
      screen.getByText("Uses about $981,000 of Alex's lifetime exemption; $19,000 is covered by the annual exclusion."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add gift" }));
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({
      kind: "gift",
      gift: { kind: "cash-once", amount: 1_000_000, recipient: { kind: "entity", id: "t1" } },
    });
    const list = screen.getByRole("list", { name: "Funding added" });
    expect(within(list).getByText("Gift")).toBeInTheDocument();
    expect(within(list).getByText(/Gift \$1,000,000/)).toBeInTheDocument();
  });

  it("removes an item with its ✕", async () => {
    const user = userEvent.setup();
    let last: FundingItem[] = [{ kind: "retitle", accountId: "a-brk" }];
    render(<Host start={last} onEmit={(i) => (last = i)} />);
    await user.click(screen.getByRole("button", { name: "Remove Move in · Joint Brokerage" }));
    expect(last).toEqual([]);
    expect(screen.queryByRole("list", { name: "Funding added" })).not.toBeInTheDocument();
  });

  it("opens an ILIT on Transfer a policy with the three-year callout, and offers only household-owned policies", async () => {
    const user = userEvent.setup();
    let last: FundingItem[] = [];
    render(<Host trust={{ ...baseTrust, kind: "ilit" }} onEmit={(i) => (last = i)} />);
    expect(tile("Transfer a policy")).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "A policy transferred within three years of death is pulled back into the estate. This projection doesn't apply that rule to a transfer.",
      ),
    ).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Policy to transfer" });
    expect(within(select).getByRole("option", { name: "Term Policy" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Trust Policy" })).not.toBeInTheDocument();
    await user.selectOptions(select, "a-pol");
    await user.click(screen.getByRole("button", { name: "Add transfer" }));
    expect(last).toEqual([{ kind: "policy", accountId: "a-pol" }]);
    expect(screen.getByText("Transfer")).toBeInTheDocument();
  });

  it("shows the IDGT sale tile disabled, with its note", () => {
    render(<Host trust={{ ...baseTrust, kind: "idgt", crummeyPowers: false }} />);
    const sale = tile("Sale for a note");
    expect(sale).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Available once the scenario is saved — then use this trust's Notes & sales tab."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Transfer a policy" })).not.toBeInTheDocument();
  });

  it("offers Move an account in only for irrevocable and SLAT", () => {
    const { unmount } = render(<Host trust={{ ...baseTrust, kind: "slat" }} />);
    expect(tile("Move an account in")).toBeInTheDocument();
    unmount();
    render(<Host trust={{ ...baseTrust, kind: "ilit" }} />);
    expect(screen.queryByRole("radio", { name: "Move an account in" })).not.toBeInTheDocument();
  });

  describe("bequest", () => {
    async function openBequest(user: ReturnType<typeof userEvent.setup>) {
      await user.click(tile("At death"));
    }

    it("unmarried: only the client's will, no When, no second-death option", async () => {
      const user = userEvent.setup();
      let last: FundingItem[] = [];
      render(<Host married={false} onEmit={(i) => (last = i)} />);
      await openBequest(user);
      expect(screen.getByRole("radio", { name: "Alex's will" })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Whoever dies second" })).not.toBeInTheDocument();
      expect(screen.queryByRole("radiogroup", { name: "When" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Add bequest" }));
      expect(last[0]).toMatchObject({ kind: "bequest", from: "client", condition: "always", what: { mode: "all_assets" } });
    });

    it("Everything has no % box; One account has one defaulting to 100", async () => {
      const user = userEvent.setup();
      render(<Host />);
      await openBequest(user);
      expect(screen.queryByRole("textbox", { name: "Percent of the account" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("radio", { name: "One account" }));
      expect(screen.getByRole("textbox", { name: "Percent of the account" })).toHaveValue("100");
    });

    it("married: Whoever dies second is the default (no When); a will's When defaults to Either way", async () => {
      const user = userEvent.setup();
      let last: FundingItem[] = [];
      render(<Host onEmit={(i) => (last = i)} />);
      await openBequest(user);
      expect(screen.getByRole("radio", { name: "Whoever dies second" })).toHaveAttribute("aria-checked", "true");
      expect(screen.queryByRole("radiogroup", { name: "When" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Add bequest" }));
      expect(last[0]).toMatchObject({ from: "second_death", condition: "if_spouse_predeceased" });
      await user.click(screen.getByRole("radio", { name: "Alex's will" }));
      expect(screen.getByRole("radio", { name: "Either way" })).toHaveAttribute("aria-checked", "true");
      await user.click(screen.getByRole("radio", { name: "Only if Jordan survives" }));
      await user.click(screen.getByRole("button", { name: "Add bequest" }));
      expect(last[1]).toMatchObject({ from: "client", condition: "if_spouse_survives" });
    });

    it("One account offers only what the will can pass, and nothing already funding this trust", async () => {
      const user = userEvent.setup();
      render(<Host start={[{ kind: "policy", accountId: "a-pol" }]} />);
      await openBequest(user);
      await user.click(screen.getByRole("radio", { name: "One account" }));
      const options = () =>
        within(screen.getByRole("combobox", { name: "Account to leave" }))
          .getAllByRole("option")
          .map((o) => o.textContent);
      expect(options()).toEqual(["Select an account…", "Joint Brokerage"]);
      cleanup();
      render(<Host start={[{ kind: "retitle", accountId: "a-brk" }]} />);
      await openBequest(user);
      await user.click(screen.getByRole("radio", { name: "One account" }));
      expect(options()).toEqual(["Select an account…"]);
    });

    it("One account: clearing and retyping the % works, 0 and 101 block Add, business accounts aren't offered", async () => {
      const user = userEvent.setup();
      let last: FundingItem[] = [];
      render(<Host onEmit={(i) => (last = i)} />);
      await openBequest(user);
      await user.click(screen.getByRole("radio", { name: "One account" }));
      const picker = screen.getByRole("combobox", { name: "Account to leave" });
      expect(within(picker).queryByRole("option", { name: "Rivera LLC" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add bequest" })).toBeDisabled();
      await user.selectOptions(picker, "a-brk");
      const pct = screen.getByRole("textbox", { name: "Percent of the account" });
      await user.clear(pct);
      expect(screen.getByRole("button", { name: "Add bequest" })).toBeDisabled();
      await user.type(pct, "101");
      expect(screen.getByRole("button", { name: "Add bequest" })).toBeDisabled();
      await user.clear(pct);
      await user.type(pct, "40");
      await user.click(screen.getByRole("button", { name: "Add bequest" }));
      expect(last[0]).toMatchObject({ kind: "bequest", what: { mode: "specific", accountId: "a-brk", percentage: 40 } });
    });

    it("shows the will-conflict note, counting bequests already added but never the one being built", async () => {
      const user = userEvent.setup();
      const jordanWill = {
        id: "w-c", grantor: "client", bequests: [], residuaryRecipients: [],
      } as unknown as NonNullable<ClientData["wills"]>[number];
      const start: FundingItem[] = [
        { kind: "bequest", from: "client", what: { mode: "all_assets" }, condition: "always" },
      ];
      render(<Host start={start} wills={[jordanWill]} />);
      await openBequest(user);
      // The existing all-assets item competes with the one being built.
      expect(screen.getByText(/this trust shares it|another clause leaving everything/)).toBeInTheDocument();
    });

    it("shows no conflict note for the first bequest on an empty will", async () => {
      const user = userEvent.setup();
      render(<Host married={false} />);
      await openBequest(user);
      expect(screen.queryByText(/this trust shares it|another clause|get nothing/)).not.toBeInTheDocument();
    });
  });

  describe("Move an account in", () => {
    it("lists eligible accounts, hides those already moved or gifted, and appends one item per tick", async () => {
      const user = userEvent.setup();
      let last: FundingItem[] = [
        { kind: "retitle", accountId: "a-ira" },
      ];
      render(<Host start={last} onEmit={(i) => (last = i)} />);
      await user.click(tile("Move an account in"));
      const group = screen.getByRole("group", { name: "Accounts to move in" });
      expect(within(group).getByRole("checkbox", { name: "Joint Brokerage" })).toBeInTheDocument();
      expect(within(group).queryByRole("checkbox", { name: "Alex IRA" })).not.toBeInTheDocument();
      expect(within(group).queryByRole("checkbox", { name: "Term Policy" })).not.toBeInTheDocument();
      expect(screen.getByText(/It isn't recorded as a gift/)).toBeInTheDocument();
      await user.click(within(group).getByRole("checkbox", { name: "Joint Brokerage" }));
      await user.click(screen.getByRole("button", { name: "Add 1 account" }));
      expect(last).toEqual([
        { kind: "retitle", accountId: "a-ira" },
        { kind: "retitle", accountId: "a-brk" },
      ]);
    });

    it("hides an account already used by an asset gift", async () => {
      const user = userEvent.setup();
      const gift = {
        kind: "asset-once", id: "g1", year: 2026, accountId: "a-brk", percent: 0.5,
        grantor: "client", recipient: { kind: "entity", id: "t1" },
      } as unknown as Extract<FundingItem, { kind: "gift" }>["gift"];
      render(<Host start={[{ kind: "gift", gift }]} />);
      await user.click(tile("Move an account in"));
      expect(screen.queryByRole("checkbox", { name: "Joint Brokerage" })).not.toBeInTheDocument();
    });

    it("doesn't offer an account already moved in as the gift form's asset", async () => {
      const user = userEvent.setup();
      render(<Host start={[{ kind: "retitle", accountId: "a-brk" }]} />);
      await user.click(screen.getByRole("button", { name: "Specific asset" }));
      const asset = screen.getByTestId("account");
      expect(within(asset).queryByRole("option", { name: "Joint Brokerage" })).not.toBeInTheDocument();
      expect(within(asset).getByRole("option", { name: "Alex IRA" })).toBeInTheDocument();
    });
  });
});
