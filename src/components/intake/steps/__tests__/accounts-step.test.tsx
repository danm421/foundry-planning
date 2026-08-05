// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { AccountsStep } from "../accounts-step";

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

  it("renders an existing account collapsed, with its category, owner, and value", () => {
    const value: AccountsSlice = [
      { name: "Fidelity Brokerage", category: "taxable", value: 100000, owner: "client" },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expect(screen.getByText("Fidelity Brokerage")).toBeInTheDocument();
    expect(screen.getByText(/Taxable brokerage · Client/)).toBeInTheDocument();
    // Scoped to the row — the KPI total reads $100,000 too with one account.
    const row = screen.getByRole("button", { name: /edit fidelity brokerage/i })
      .parentElement!;
    expect(within(row).getByText("$100,000")).toBeInTheDocument();
    // Collapsed: no editable fields until Edit is clicked.
    expect(screen.queryByDisplayValue("Fidelity Brokerage")).not.toBeInTheDocument();
  });

  it("clicking Edit expands the row into name, category, owner, and value inputs", () => {
    const value: AccountsSlice = [
      { name: "Fidelity Brokerage", category: "taxable", value: 100000 },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit fidelity brokerage/i);

    expect(screen.getByDisplayValue("Fidelity Brokerage")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /category/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /owner/i })).toBeInTheDocument();
    // value input is a formatted money field: 100000 → "100,000"
    expect(screen.getByDisplayValue("100,000")).toBeInTheDocument();
  });

  it("editing the name calls onChange with updated account name", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [{ name: "Fidelity", category: "taxable", value: 50000 }];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    expandRow(/edit fidelity/i);
    fireEvent.change(screen.getByDisplayValue("Fidelity"), {
      target: { value: "Vanguard" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.name).toBe("Vanguard");
  });

  it("changing category calls onChange with the new category", () => {
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

    expect(screen.getByText(/Retirement \(IRA \/ 401k\) · Alex/)).toBeInTheDocument();
  });

  // ── Collapse behaviour ───────────────────────────────────────────────────

  it("expands only one account at a time — editing a second collapses the first", () => {
    const value: AccountsSlice = [
      { name: "Account A", category: "taxable", value: 1000 },
      { name: "Account B", category: "cash", value: 2000 },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit account a/i);
    expect(screen.getByDisplayValue("Account A")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Account B")).not.toBeInTheDocument();

    expandRow(/edit account b/i);
    expect(screen.getByDisplayValue("Account B")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Account A")).not.toBeInTheDocument();
  });

  it("Done collapses the open editor back to a summary row", () => {
    const value: AccountsSlice = [{ name: "Account A", category: "taxable", value: 1000 }];
    render(<AccountsStep {...makeProps({ value })} />);

    expandRow(/edit account a/i);
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    expect(screen.queryByDisplayValue("Account A")).not.toBeInTheDocument();
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
