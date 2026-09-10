// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountsTable from "../accounts-table";

const rows = [
  { __rowId: "r1", name: "Schwab Taxable 0707", value: 8_618.6, basis: 3_919.45,
    accountNumberLast4: "0990", custodian: "Charles Schwab",
    category: "taxable", subType: "brokerage",
    owners: [{ name: "Michael V Sharesky" }] },
  { __rowId: "r2", name: "Schwab Roth IRA", value: 22_873.46, basis: 10_010.17,
    accountNumberLast4: "1168", custodian: "Charles Schwab",
    category: "retirement", subType: "roth_ira",
    ownerNameHint: "MICHAEL V SHARESKY ROTH IRA" },
] as never;

describe("accounts table", () => {
  it("renders the seven spec columns in order", () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name", "Value", "Basis", "Last 4", "Owner", "Custodian", "Account type", "",
    ]);
  });

  it("commits a single row without touching its neighbours", async () => {
    const onCommitRows = vi.fn();
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={onCommitRows} onEditCell={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /commit/i }));
    expect(onCommitRows).toHaveBeenCalledWith(["r2"]);
  });

  it("renders a resolved owner name when matching succeeded", () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} />);
    const taxable = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(taxable).getByText("Michael V Sharesky")).toBeInTheDocument();
  });

  it("falls back to the registration hint, marked as unconfirmed", () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    const owner = within(roth).getByText(/MICHAEL V SHARESKY ROTH IRA/);
    expect(owner.closest("[data-assumed]")).not.toBeNull();
  });

  it("locks a committed row against re-posting", () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={["r1"]} onCommitRows={vi.fn()} onEditCell={vi.fn()} />);
    const taxable = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(taxable).getByRole("button", { name: /committed/i })).toBeDisabled();
  });

  it("shows an excluded rollup with its reason and a restore toggle", async () => {
    const onEditCell = vi.fn();
    const excluded = [{
      row: { __rowId: "r9", name: "All Accounts", value: 21_475.2 },
      decision: { kind: "rollup-excluded", label: "All Accounts", value: 21_475.2, coversCount: 3 },
    }] as never;
    render(<AccountsTable rows={rows} excluded={excluded} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={onEditCell} />);
    expect(screen.getByText(/total covering 3 accounts/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /include anyway/i })).toBeInTheDocument();
  });

  it("scrolls the table sideways rather than the page", () => {
    const { container } = render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} />);
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
  });
});

/**
 * Task 12, requirement B. The extractor's `owner` guess is no longer a
 * dedupe key, so it is no longer load-bearing for identity — but it IS still
 * decisive at COMMIT: the statement-chat path never seeds `row.owners`, so
 * `commit/accounts.ts` falls through to
 * `synthesizeAccountOwners(tx, accountId, row.owner, family, isRetirement)`
 * and writes ownership straight from the coarse enum. The guess stops
 * mattering only once a human can correct it in one click before committing,
 * which is what this cell is.
 */
describe("accounts table — the Owner cell is editable", () => {
  it("opens an Owner dropdown on a row that has not been committed", async () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /MICHAEL V SHARESKY ROTH IRA/ }));
    expect(within(roth).getByLabelText("Owner")).toBeInTheDocument();
    // The registration name is the evidence the advisor decides on — the one
    // field that stayed stable while the guess moved — so the editor shows it.
    expect(within(roth).getByText(/MICHAEL V SHARESKY ROTH IRA/)).toBeInTheDocument();
  });

  it("writes exactly one field, once, when an owner is picked", async () => {
    const onEditCell = vi.fn();
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={onEditCell} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /MICHAEL V SHARESKY ROTH IRA/ }));
    await userEvent.selectOptions(within(roth).getByLabelText("Owner"), "spouse");

    // One field, one call — `owner` is a single value, so this must NOT go
    // through the multi-field `fields: [...]` fan-out the Account-type
    // editor needs.
    expect(onEditCell).toHaveBeenCalledTimes(1);
    expect(onEditCell).toHaveBeenCalledWith("r2", "owner", "spouse");
  });

  // `entity-table.tsx` computes `canEdit = !!col.edit && !!rowId &&
  // !isCommitted`, so a committed row must render no editor at all —
  // otherwise an advisor edits a row whose account is already written and
  // the correction goes nowhere. The un-committed row in the same table is
  // the positive control: it still offers the editor.
  it("offers no Owner editor on a committed row", async () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={["r1"]} onCommitRows={vi.fn()} onEditCell={vi.fn()} />);
    const taxable = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(taxable).queryByRole("button", { name: "Michael V Sharesky" })).toBeNull();
    expect(within(taxable).queryByLabelText("Owner")).toBeNull();

    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /MICHAEL V SHARESKY ROTH IRA/ }));
    expect(within(roth).getByLabelText("Owner")).toBeInTheDocument();
  });
});
