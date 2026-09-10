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
