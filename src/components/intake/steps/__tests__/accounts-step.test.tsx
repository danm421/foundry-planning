// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { AccountsStep } from "../accounts-step";
import { intakeFallbackSubType, subTypesForCategory } from "@/lib/intake/account-types";

type AccountsSlice = IntakeDraft["accounts"];

const emptyValue: AccountsSlice = [];

function makeProps(
  overrides: Partial<{
    value: AccountsSlice;
    onChange: (v: AccountsSlice) => void;
    clientName: string;
    spouseName: string;
    hasSpouse: boolean;
  }> = {},
) {
  return {
    value: emptyValue,
    onChange: vi.fn(),
    ...overrides,
  };
}

/** Click "Edit" on the collapsed row whose name matches, expanding its editor. */
function expandRow(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("AccountsStep", () => {
  it("renders an Add account button when the list is empty", () => {
    render(<AccountsStep {...makeProps()} />);
    expect(screen.getByRole("button", { name: /add account/i })).toBeInTheDocument();
  });

  it("clicking Add account calls onChange with a new account entry", () => {
    const onChange = vi.fn();
    render(<AccountsStep {...makeProps({ onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /add account/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.owner).toBe("client");
  });

  it("renders an existing account collapsed, with its type, owner, and value", () => {
    const value: AccountsSlice = [
      {
        name: "Fidelity Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: 100000,
        owner: "client",
      },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expect(screen.getByText("Fidelity Brokerage")).toBeInTheDocument();
    expect(screen.getByText(/Brokerage · Client/)).toBeInTheDocument();
    // Scoped to the row — the KPI total reads $100,000 too with one account.
    const row = screen.getByRole("button", { name: /edit fidelity brokerage/i })
      .parentElement!;
    expect(within(row).getByText("$100,000")).toBeInTheDocument();
    // Collapsed: no editable fields until Edit is clicked.
    expect(screen.queryByRole("combobox", { name: /category/i })).not.toBeInTheDocument();
  });

  it("clicking Edit expands the row into category, type, owner, and value inputs", () => {
    const value: AccountsSlice = [
      { name: "Fidelity Brokerage", category: "taxable", value: 100000 },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit fidelity brokerage/i);

    expect(screen.getByRole("combobox", { name: /category/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^type$/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /owner/i })).toBeInTheDocument();
    // value input is a formatted money field: 100000 → "100,000"
    expect(screen.getByDisplayValue("100,000")).toBeInTheDocument();
    // The name is derived, never typed.
    expect(screen.queryByRole("textbox", { name: /account name/i })).not.toBeInTheDocument();
  });

  it("changing category calls onChange with the new category and its default type", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [{ name: "IRA", category: "taxable", value: 0 }];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    expandRow(/edit ira/i);
    fireEvent.change(screen.getByRole("combobox", { name: /category/i }), {
      target: { value: "retirement" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.category).toBe("retirement");
    // A taxable sub-type must not survive into Retirement — the submit schema
    // rejects a pair the picker can't render.
    expect(next?.[0]?.subType).toBe("traditional_ira");
  });

  it("changing value calls onChange with the numeric value", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [{ name: "Savings", category: "cash", value: 0 }];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    expandRow(/edit savings/i);
    fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "25000" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.value).toBe(25000);
  });

  it("clicking the row's remove control calls onChange without that account", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [
      { name: "Account A", category: "taxable", value: 1000 },
      { name: "Account B", category: "cash", value: 2000 },
    ];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /remove account a/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.name).toBe("Account B");
  });

  // ── Tax basis ────────────────────────────────────────────────────────────

  it("asks for tax basis on a taxable account and reports it numerically", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [{ name: "Brokerage", category: "taxable", value: 100000 }];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    expandRow(/edit brokerage/i);
    const basis = screen.getByRole("textbox", { name: /tax basis/i });
    fireEvent.change(basis, { target: { value: "60000" } });

    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.basis).toBe(60000);
  });

  it("clears a stale basis when the category stops asking for one", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [
      { name: "Brokerage", category: "taxable", value: 100000, basis: 60000 },
    ];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    expandRow(/edit brokerage/i);
    fireEvent.change(screen.getByRole("combobox", { name: /category/i }), {
      target: { value: "cash" },
    });

    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.category).toBe("cash");
    expect(next?.[0]?.basis).toBeUndefined();
  });

  it("omits tax basis for cash and retirement accounts", () => {
    const value: AccountsSlice = [{ name: "Checking", category: "cash", value: 5000 }];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit checking/i);
    expect(screen.queryByRole("textbox", { name: /tax basis/i })).not.toBeInTheDocument();
  });

  // ── Owner ────────────────────────────────────────────────────────────────

  it("offers only the client as owner when there is no spouse", () => {
    const value: AccountsSlice = [{ name: "IRA", category: "retirement", value: 1000 }];
    render(<AccountsStep {...makeProps({ value, clientName: "Dana" })} />);

    expandRow(/edit ira/i);
    const owner = screen.getByRole("combobox", { name: /owner/i });
    expect(within(owner).getAllByRole("option")).toHaveLength(1);
    expect(within(owner).getByRole("option", { name: "Dana" })).toBeInTheDocument();
  });

  it("offers client, spouse, and joint when a spouse is present", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [{ name: "IRA", category: "retirement", value: 1000 }];
    render(
      <AccountsStep
        {...makeProps({ value, onChange, clientName: "Dana", spouseName: "Alex", hasSpouse: true })}
      />,
    );

    expandRow(/edit ira/i);
    const owner = screen.getByRole("combobox", { name: /owner/i });
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Dana",
      "Alex",
      "Joint",
    ]);

    fireEvent.change(owner, { target: { value: "spouse" } });
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.owner).toBe("spouse");
  });

  it("labels a collapsed row with the spouse's name when they own it", () => {
    const value: AccountsSlice = [
      { name: "Rollover IRA", category: "retirement", value: 250000, owner: "spouse" },
    ];
    render(
      <AccountsStep {...makeProps({ value, clientName: "Dana", spouseName: "Alex", hasSpouse: true })} />,
    );

    expect(screen.getByText(/Retirement · Alex/)).toBeInTheDocument();
  });

  // ── Account type (category → sub-type) ───────────────────────────────────

  it("offers the six core categories", () => {
    const value: AccountsSlice = [{ name: "Acct", category: "taxable", value: 0 }];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit acct/i);
    const category = screen.getByRole("combobox", { name: /category/i });
    expect(within(category).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Taxable investments",
      "Cash & savings",
      "Retirement",
      "Education savings",
      "Annuity",
      "Life insurance",
    ]);
  });

  it("offers the retirement sub-types under Retirement", () => {
    const value: AccountsSlice = [
      { name: "Acct", category: "retirement", subType: "roth_ira", value: 0 },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit acct/i);
    const type = screen.getByRole("combobox", { name: /^type$/i });
    expect(within(type).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Traditional IRA",
      "Roth IRA",
      "401(k)",
      "403(b)",
      "401(a)",
      "SEP IRA",
      "SIMPLE IRA",
      "HSA",
      "Other retirement account",
    ]);
    expect((type as HTMLSelectElement).value).toBe("roth_ira");
  });

  it("changing the type calls onChange with the new sub-type", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [
      { name: "Acct", category: "retirement", subType: "traditional_ira", value: 0 },
    ];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    expandRow(/edit acct/i);
    fireEvent.change(screen.getByRole("combobox", { name: /^type$/i }), {
      target: { value: "401k" },
    });

    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.subType).toBe("401k");
  });

  it("hides the type picker where the category has no meaningful split", () => {
    const value: AccountsSlice = [{ name: "Acct", category: "annuity", value: 0 }];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit acct/i);
    expect(screen.queryByRole("combobox", { name: /^type$/i })).not.toBeInTheDocument();
  });

  it("assigns 529 silently rather than showing a one-option picker", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [{ name: "Acct", category: "taxable", value: 0 }];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    expandRow(/edit acct/i);
    fireEvent.change(screen.getByRole("combobox", { name: /category/i }), {
      target: { value: "education_savings" },
    });

    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.subType).toBe("529");
  });

  // ── Derived name ─────────────────────────────────────────────────────────

  it("names a new account from its type and owner — never blank", () => {
    const onChange = vi.fn();
    render(<AccountsStep {...makeProps({ onChange, clientName: "Dana" })} />);

    fireEvent.click(screen.getByRole("button", { name: /add account/i }));

    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.name).toBe("Brokerage - Dana");
  });

  it("re-derives the name as type, owner, and custodian change", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [
      { name: "Brokerage - Dana", category: "retirement", subType: "roth_ira", value: 0 },
    ];
    const props = makeProps({
      value,
      onChange,
      clientName: "Dana",
      spouseName: "Alex",
      hasSpouse: true,
    });
    const { rerender } = render(<AccountsStep {...props} />);

    expandRow(/edit brokerage - dana/i);
    fireEvent.change(screen.getByRole("combobox", { name: /owner/i }), {
      target: { value: "spouse" },
    });
    const afterOwner: AccountsSlice = onChange.mock.calls[0][0];
    expect(afterOwner?.[0]?.name).toBe("Roth IRA - Alex");

    rerender(<AccountsStep {...props} value={afterOwner} />);
    fireEvent.change(screen.getByRole("textbox", { name: /custodian/i }), {
      target: { value: "Fidelity" },
    });
    const afterCustodian: AccountsSlice = onChange.mock.calls[1][0];
    expect(afterCustodian?.[0]?.name).toBe("Roth IRA - Alex - Fidelity");
  });

  it("shows the client the name their answers will be saved under", () => {
    const value: AccountsSlice = [
      {
        name: "Roth IRA - Dana - Fidelity",
        category: "retirement",
        subType: "roth_ira",
        value: 0,
        custodian: "Fidelity",
      },
    ];
    render(<AccountsStep {...makeProps({ value, clientName: "Dana" })} />);

    expandRow(/edit roth ira - dana - fidelity/i);
    expect(screen.getByText("Saved as")).toBeInTheDocument();
    // Once in the "Saved as" panel; the collapsed-row title is gone while open.
    expect(screen.getByText("Roth IRA - Dana - Fidelity")).toBeInTheDocument();
  });

  // ── Collapse behaviour ───────────────────────────────────────────────────

  it("expands only one account at a time — editing a second collapses the first", () => {
    const value: AccountsSlice = [
      { name: "Account A", category: "taxable", value: 1000, custodian: "Alpha" },
      { name: "Account B", category: "cash", value: 2000, custodian: "Beta" },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit account a/i);
    expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Beta")).not.toBeInTheDocument();

    expandRow(/edit account b/i);
    expect(screen.getByDisplayValue("Beta")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument();
  });

  it("Done collapses the open editor back to a summary row", () => {
    const value: AccountsSlice = [
      { name: "Account A", category: "taxable", value: 1000, custodian: "Alpha" },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit account a/i);
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Account A")).toBeInTheDocument();
  });

  // ── KPI totals ───────────────────────────────────────────────────────────

  it("totals the account values and count at the top", () => {
    const value: AccountsSlice = [
      { name: "Account A", category: "taxable", value: 1000 },
      { name: "Account B", category: "cash", value: 2500 },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expect(screen.getByText("Total value")).toBeInTheDocument();
    expect(screen.getByText("$3,500")).toBeInTheDocument();
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("intake annuity sub-type", () => {
  it("still does not ask a household how their annuity is taxed", () => {
    // Qualified vs non-qualified is not something a client can answer
    // unaided, which is the line this taxonomy is trimmed to.
    expect(subTypesForCategory("annuity")).toEqual([]);
  });

  it("lands an annuity on non_qualified rather than 'other'", () => {
    // 'other' is no longer a sub-type the advisor's Account Type dropdown
    // offers, so an intake account left on it would open with a blank Type.
    expect(intakeFallbackSubType("annuity")).toBe("non_qualified");
    expect(intakeFallbackSubType("taxable")).toBe("other");
  });
});
