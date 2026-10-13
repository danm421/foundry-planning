// @vitest-environment jsdom
// src/components/fact-finder/__tests__/holdings.test.tsx
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyOps, FactFinderOpError, type ClientOp } from "@/lib/fact-finder/ops";
import { findSection, type FFPage } from "@/lib/fact-finder/schema";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFCellValue, FFHolding, FFRow, FFUnassignedHolding } from "@/lib/fact-finder/types";
import { PageView } from "../page-view";

const CTX = { by: "advisor" as const, now: "2026-10-13T12:00:00.000Z", newId: () => "new-id" };

const holding = (id: string, values: Partial<FFHolding>): FFHolding => ({
  id,
  ticker: null,
  name: null,
  shares: null,
  price: null,
  marketValue: null,
  costBasis: null,
  by: "document",
  ...values,
});
const account = (id: string, values: Record<string, FFCellValue>, holdings?: FFHolding[]): FFRow => ({
  id,
  cells: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, by: "advisor", pinned: true }])),
  sourceFileIds: [],
  ...(holdings ? { holdings } : {}),
});

// VTI has no market value on the statement: shares × price counts instead.
const vti = holding("h1", { ticker: "VTI", name: "Vanguard Total Stock Market", shares: 100, price: 100, costBasis: 8000 });
const bnd = holding("h2", { ticker: "BND", name: "Vanguard Total Bond", marketValue: 5000 });
const brokerage = (currentValue: number | null) =>
  account("t1", { accountName: "Joint Brokerage", currentValue }, [vti, bnd]);
const aapl: FFUnassignedHolding = { ...holding("u1", { ticker: "AAPL", name: "Apple Inc", shares: 50, marketValue: 9000 }), accountHint: "IRA 7781" };

function stateWith(sections: Record<string, FFRow[]>, unassignedHoldings: FFUnassignedHolding[] = []): FactFinderState {
  const s = emptyFactFinderState();
  return { ...s, unassignedHoldings, sections: { ...s.sections, ...sections } };
}

/** The page as the screen renders it, with the real ops behind onApply (false on a refused edit). */
function renderPage(initial: FactFinderState, page: FFPage = "accounts") {
  const applied = vi.fn<(ops: ClientOp[]) => void>();
  function Harness() {
    const [state, setState] = useState(initial);
    const onApply = (ops: ClientOp[]) => {
      applied(ops);
      try {
        setState(applyOps(state, ops, CTX));
        return true;
      } catch (e) {
        if (e instanceof FactFinderOpError) return false;
        throw e;
      }
    };
    return <PageView page={page} state={state} onApply={onApply} fileName={() => undefined} entities={[]} />;
  }
  render(<Harness />);
  return { applied };
}

const expandBrokerage = () => userEvent.click(screen.getByRole("button", { name: "2 holdings in Joint Brokerage" }));

/** The "N holdings" toggle and its figure — what the holdings add up to, which describes the toggle. */
function toggleOf(name: string) {
  const toggle = screen.getByRole("button", { name });
  return { toggle, figure: document.getElementById(toggle.getAttribute("aria-describedby") ?? "") };
}

describe("holdings under an account row", () => {
  it("shows N holdings under the row, collapsed, and expands to the holdings table", async () => {
    renderPage(stateWith({ taxable: [brokerage(15000), account("t2", { accountName: "Empty Brokerage" })] }));
    const accounts = screen.getByRole("table", { name: "Taxable Investment Accounts" });
    const toggle = within(accounts).getByRole("button", { name: "2 holdings in Joint Brokerage" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The holdings line spans the row header, every column, Links to and the actions cell.
    expect((toggle.closest("td") as HTMLTableCellElement).colSpan).toBe(findSection("taxable")!.columns.length + 3);
    expect(within(accounts).queryByRole("button", { name: /in Empty Brokerage$/ })).toBeNull();
    expect(screen.queryByRole("table", { name: "Holdings in Joint Brokerage" })).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByRole("table", { name: "Holdings in Joint Brokerage" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Ticker",
      "Name",
      "Shares",
      "Price",
      "Market value",
      "Cost basis",
    ]);
    expect(within(table).getByRole("button", { name: "Edit price for VTI: $100.00" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Edit market value for VTI: blank" })).toHaveTextContent("—");
    expect(within(table).getByRole("button", { name: "Edit market value for BND: $5,000" })).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByRole("table", { name: "Holdings in Joint Brokerage" })).toBeNull();
  });

  it("shows what the holdings add up to against the current value", () => {
    renderPage(
      stateWith({
        taxable: [brokerage(15000)],
        retirement: [account("r1", { accountName: "Rollover IRA", currentValue: 20000 }, [vti, bnd])],
        edu: [account("e1", { accountName: "College 529", currentValue: 12000 }, [vti, bnd])],
      }),
    );
    const matches = toggleOf("2 holdings in Joint Brokerage");
    expect(matches.toggle).toHaveAccessibleDescription("Adds up to $15,000 of $15,000");
    expect(matches.figure).not.toHaveClass("text-warn");
    const short = toggleOf("2 holdings in Rollover IRA");
    expect(short.toggle).toHaveAccessibleDescription("Adds up to $15,000 of $20,000 · $5,000 short");
    expect(short.figure).toHaveClass("text-warn");
    const over = toggleOf("2 holdings in College 529");
    expect(over.toggle).toHaveAccessibleDescription("Adds up to $15,000 of $12,000 · $3,000 over");
    expect(over.figure).toHaveClass("text-warn");
  });

  it("says when there is no current value to compare with", () => {
    renderPage(stateWith({ taxable: [brokerage(null)] }));
    const { toggle, figure } = toggleOf("2 holdings in Joint Brokerage");
    expect(toggle).toHaveAccessibleDescription("Adds up to $15,000 · no current value to compare");
    expect(figure).not.toHaveClass("text-warn");
  });

  it("clicking a figure edits it; Enter saves it as setHolding and the total follows", async () => {
    const { applied } = renderPage(stateWith({ taxable: [brokerage(15000)] }));
    await expandBrokerage();

    await userEvent.click(screen.getByRole("button", { name: "Edit shares for VTI: 100" }));
    const shares = screen.getByRole("textbox", { name: "Shares for VTI" });
    expect(shares).toHaveFocus();
    expect(shares).toHaveValue("100");
    await userEvent.clear(shares);
    await userEvent.type(shares, "120{Enter}");
    expect(applied).toHaveBeenLastCalledWith([
      { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1", field: "shares", value: "120" },
    ]);
    expect(screen.getByRole("button", { name: "Edit shares for VTI: 120" })).toHaveFocus();
    expect(toggleOf("2 holdings in Joint Brokerage").toggle).toHaveAccessibleDescription(
      "Adds up to $17,000 of $15,000 · $2,000 over",
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit market value for BND: $5,000" }));
    const value = screen.getByRole("textbox", { name: "Market value for BND" });
    await userEvent.clear(value);
    await userEvent.type(value, "3000");
    await userEvent.tab();
    expect(applied).toHaveBeenLastCalledWith([
      { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h2", field: "marketValue", value: "3000" },
    ]);
    expect(toggleOf("2 holdings in Joint Brokerage").toggle).toHaveAccessibleDescription("Adds up to $15,000 of $15,000");
  });

  it("a refused value shows the stored one again; Escape changes nothing", async () => {
    const { applied } = renderPage(stateWith({ taxable: [brokerage(15000)] }));
    await expandBrokerage();

    await userEvent.click(screen.getByRole("button", { name: "Edit price for VTI: $100.00" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Price for VTI" }), "abc{Enter}");
    expect(applied).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Edit price for VTI: $100.00" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit name for BND: Vanguard Total Bond" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name for BND" }), " ETF{Escape}");
    expect(applied).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Edit name for BND: Vanguard Total Bond" })).toHaveFocus();
  });

  it("Remove takes a holding out of the account", async () => {
    const { applied } = renderPage(stateWith({ taxable: [brokerage(15000)] }));
    await expandBrokerage();
    await userEvent.click(screen.getByRole("button", { name: "Remove BND" }));
    expect(applied).toHaveBeenLastCalledWith([{ op: "removeHolding", sectionId: "taxable", rowId: "t1", holdingId: "h2" }]);
    const { toggle } = toggleOf("1 holding in Joint Brokerage");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleDescription("Adds up to $10,000 of $15,000 · $5,000 short");
    expect(screen.queryByRole("button", { name: "Remove BND" })).toBeNull();
  });
});

describe("unassigned holdings on the Accounts page", () => {
  it("isn't there when no holding is waiting for an account", () => {
    renderPage(stateWith({ taxable: [brokerage(15000)] }));
    expect(screen.queryByRole("region", { name: "Unassigned holdings" })).toBeNull();
  });

  it("isn't on another page", () => {
    renderPage(stateWith({}, [aapl]), "household");
    expect(screen.queryByRole("region", { name: "Unassigned holdings" })).toBeNull();
  });

  it("lists each holding with where the document put it", () => {
    renderPage(stateWith({ taxable: [brokerage(15000)] }, [aapl, { ...holding("u2", { name: "Cash sweep" }), accountHint: "" }]));
    const block = screen.getByRole("region", { name: "Unassigned holdings" });
    const [first, second] = within(block).getAllByRole("listitem");
    expect(first).toHaveTextContent("AAPL · Apple Inc");
    expect(first).toHaveTextContent("50 shares · $9,000 · Listed under “IRA 7781”");
    expect(second).toHaveTextContent("Cash sweep");
    expect(second).toHaveTextContent("No account given");
  });

  it("picking an account moves the holding there", async () => {
    const { applied } = renderPage(
      stateWith(
        { taxable: [brokerage(15000)], retirement: [account("r1", { accountName: "Rollover IRA", currentValue: 9000 })] },
        [aapl],
      ),
    );
    const picker = within(screen.getByRole("region", { name: "Unassigned holdings" })).getByRole("combobox", {
      name: "Account for AAPL",
    });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Move to…",
      "1. Joint Brokerage",
      "1. Rollover IRA",
    ]);
    expect(within(picker).getByRole("group", { name: "Retirement Accounts" })).toHaveTextContent("1. Rollover IRA");

    await userEvent.selectOptions(picker, "1. Rollover IRA");
    expect(applied).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Move AAPL" }));
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenLastCalledWith([
      { op: "assignHolding", holdingId: "u1", from: "unassigned", to: { sectionId: "retirement", rowId: "r1" } },
    ]);
    expect(screen.queryByRole("region", { name: "Unassigned holdings" })).toBeNull();
    expect(toggleOf("1 holding in Rollover IRA").toggle).toHaveAccessibleDescription("Adds up to $9,000 of $9,000");
  });

  it("choosing an account only chooses: nothing moves until Move is pressed (a stray digit or arrow key is harmless)", async () => {
    const { applied } = renderPage(
      stateWith(
        { taxable: [brokerage(15000)], retirement: [account("r1", { accountName: "Rollover IRA", currentValue: 9000 })] },
        [aapl],
      ),
    );
    const block = screen.getByRole("region", { name: "Unassigned holdings" });
    const picker = within(block).getByRole("combobox", { name: "Account for AAPL" });
    const move = within(block).getByRole("button", { name: "Move AAPL" });
    expect(move).toBeDisabled();

    fireEvent.change(picker, { target: { value: "t1" } });
    fireEvent.change(picker, { target: { value: "r1" } });
    expect(applied).not.toHaveBeenCalled();
    expect(within(block).getByText("AAPL · Apple Inc")).toBeInTheDocument();
    expect(move).toBeEnabled();

    await userEvent.click(move);
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenCalledWith([
      { op: "assignHolding", holdingId: "u1", from: "unassigned", to: { sectionId: "retirement", rowId: "r1" } },
    ]);
  });

  it("says to add an account first when there is none to move it to", () => {
    renderPage(stateWith({}, [aapl]));
    const block = screen.getByRole("region", { name: "Unassigned holdings" });
    expect(within(block).queryByRole("combobox")).toBeNull();
    expect(within(block).getByText("Add an investment, retirement or 529 account to move it to.")).toBeInTheDocument();
  });
});
