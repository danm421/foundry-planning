// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import SellLegEditor from "../asset-transaction-sell-leg";
import { emptySellLeg, type SellLegDraft } from "../asset-transaction-leg-model";
import type { BusinessSaleOption, SellSourceAccount } from "@/lib/techniques/sell-source-options";

const accounts: SellSourceAccount[] = [
  { id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage", value: 500_000 },
  {
    id: "bizcash", name: "Friends Inc. — Cash", category: "cash", subType: "checking",
    value: 50_000, isDefaultChecking: true, parentAccountId: "biz1",
  },
  {
    id: "trustcash", name: "Ray Trust — Cash", category: "cash", subType: "checking",
    value: 20_000, isDefaultChecking: true, isEntityOwned: true,
  },
  {
    id: "biz1", name: "Friends Inc.", category: "business", subType: "llc",
    value: 1_000_000, parentAccountId: null,
  },
  {
    id: "bizprop", name: "LLC Warehouse", category: "real_estate",
    subType: "commercial_property", value: 800_000, parentAccountId: "biz1",
  },
];

const businesses: BusinessSaleOption[] = [
  {
    id: "biz1", name: "Friends Inc.", businessTypeLabel: "LLC",
    value: 1_000_000, basis: 250_000,
    owners: [{ familyMemberId: "fm1", familyMemberName: "Dana Ray", percent: 1 }],
    childAccounts: [
      { id: "bizcash", name: "Friends Inc. — Cash", currentValue: 50_000 },
      { id: "bizprop", name: "LLC Warehouse", currentValue: 800_000 },
    ],
    childLiabilities: [{ id: "l1", name: "Warehouse Mortgage", currentBalance: 400_000 }],
  },
];

function renderEditor(leg: SellLegDraft, onChange = vi.fn()) {
  render(
    <SellLegEditor
      leg={leg}
      year={2030}
      onChange={onChange}
      accounts={accounts}
      liabilities={[]}
      businesses={businesses}
      pastBuys={[]}
      projectionYears={null}
    />,
  );
  return onChange;
}

const sourceSelect = () => screen.getByLabelText(/Asset to Sell/i) as HTMLSelectElement;
const optionTexts = () =>
  Array.from(sourceSelect().querySelectorAll("option")).map((o) => o.textContent ?? "");

describe("SellLegEditor — source options", () => {
  it("hides the auto-provisioned cash bucket of a business", () => {
    renderEditor(emptySellLeg("s"));
    expect(optionTexts().some((t) => t.includes("Friends Inc. — Cash"))).toBe(false);
  });

  it("hides the auto-provisioned cash bucket of a trust", () => {
    renderEditor(emptySellLeg("s"));
    expect(optionTexts().some((t) => t.includes("Ray Trust — Cash"))).toBe(false);
  });

  it("keeps a business's real holdings sellable on their own", () => {
    renderEditor(emptySellLeg("s"));
    expect(optionTexts().some((t) => t.startsWith("LLC Warehouse"))).toBe(true);
  });

  it("shows each account's current value beside its name", () => {
    renderEditor(emptySellLeg("s"));
    expect(optionTexts()).toContain("Brokerage — $500,000");
  });

  it("prices a business at its operating value plus everything it owns", () => {
    renderEditor(emptySellLeg("s"));
    // 1,000,000 operating + 50,000 cash + 800,000 warehouse
    expect(optionTexts()).toContain("Friends Inc. (LLC) — $1,850,000");
  });

  it("offers the business only once — never as a plain account", () => {
    renderEditor(emptySellLeg("s"));
    const values = Array.from(sourceSelect().querySelectorAll("option")).map((o) => o.value);
    expect(values).toContain("biz:biz1");
    expect(values).not.toContain("biz1");
  });
});

describe("SellLegEditor — picking a business", () => {
  it("routes the leg through the business cascade, clearing the account fields", () => {
    const leg = { ...emptySellLeg("s"), sellAccountId: "a1" };
    const onChange = renderEditor(leg);
    fireEvent.change(sourceSelect(), { target: { value: "biz:biz1" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sellMode: "business",
        sellBusinessAccountId: "biz1",
        sellAccountId: "",
        sellPurchaseTransactionId: "",
      }),
    );
  });

  it("drops $-amount mode, which a business sale has no meaning for", () => {
    const leg = { ...emptySellLeg("s"), sellAmountMode: "dollar" as const };
    const onChange = renderEditor(leg);
    fireEvent.change(sourceSelect(), { target: { value: "biz:biz1" } });
    expect(onChange.mock.calls[0][0].sellAmountMode).toBe("full");
  });

  it("lists everything the sale disposes of, and the debt it settles", () => {
    renderEditor({
      ...emptySellLeg("s"), sellMode: "business", sellBusinessAccountId: "biz1",
    });
    expect(screen.getByText("Total assets $1,850,000")).toBeTruthy();
    expect(screen.getByText("LLC Warehouse")).toBeTruthy();
    expect(screen.getByText("Warehouse Mortgage (paid off)")).toBeTruthy();
    expect(screen.getByText("Net of debt")).toBeTruthy();
  });

  it("pre-fills the value field with the OPERATING value, not the total", () => {
    renderEditor({
      ...emptySellLeg("s"), sellMode: "business", sellBusinessAccountId: "biz1",
    });
    const input = screen.getByLabelText(/Business value/i, {
      selector: "input",
    }) as HTMLInputElement;
    expect(input.value.replace(/[$,]/g, "")).toBe("1000000");
  });

  it("warns when the business has no owner, which makes the sale a no-op", () => {
    render(
      <SellLegEditor
        leg={{ ...emptySellLeg("s"), sellMode: "business", sellBusinessAccountId: "biz1" }}
        year={2030}
        onChange={vi.fn()}
        accounts={accounts}
        liabilities={[]}
        businesses={[{ ...businesses[0], owners: [] }]}
        pastBuys={[]}
        projectionYears={null}
      />,
    );
    expect(screen.getByText(/No owner is recorded on this business/i)).toBeTruthy();
  });
});

describe("SellLegEditor — picking an account", () => {
  it("clears a previously chosen business", () => {
    const leg = { ...emptySellLeg("s"), sellMode: "business" as const, sellBusinessAccountId: "biz1" };
    const onChange = renderEditor(leg);
    fireEvent.change(sourceSelect(), { target: { value: "a1" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sellMode: "account",
        sellAccountId: "a1",
        sellBusinessAccountId: "",
      }),
    );
  });

  it("keeps showing the source picker when no businesses exist", () => {
    render(
      <SellLegEditor
        leg={emptySellLeg("s")} year={2030} onChange={vi.fn()}
        accounts={accounts} liabilities={[]} businesses={[]} pastBuys={[]}
        projectionYears={null}
      />,
    );
    const select = screen.getByLabelText(/Asset to Sell/i);
    expect(within(select).queryByText(/Businesses/)).toBeNull();
    expect(select.querySelectorAll("option").length).toBeGreaterThan(1);
  });
});
