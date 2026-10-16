// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountsTab } from "../accounts-tab";

const account = (over: Record<string, unknown>) => ({
  subType: "other",
  custodian: null,
  accountNumberLast4: null,
  basis: "0",
  marginBalance: "0",
  owners: [],
  ...over,
});

// $10M brokerage carrying a $2M margin loan, beside a no-loan cash account and
// a home: every figure on the tab — row, section subtotal, headline — is net.
const household = {
  planningClient: { id: "cl1" },
  planningAccounts: [
    account({ id: "brk", name: "Margined Brokerage", category: "taxable", subType: "brokerage",
      value: "10000000", marginBalance: "2000000" }),
    account({ id: "chk", name: "Checking", category: "cash", subType: "checking", value: "500000" }),
    account({ id: "home", name: "Home", category: "real_estate", subType: "primary_residence",
      value: "1000000" }),
  ],
} as never;

describe("AccountsTab — margin loan", () => {
  it("shows a margined account, its section and the net-worth total net of the loan", () => {
    render(<AccountsTab household={household} />);
    expect(screen.getByText("$9,500,000")).toBeInTheDocument(); // Net worth · Total
    expect(screen.getAllByText("$8,500,000")).toHaveLength(2); // Accounts metric + section header
    expect(screen.getByText("$8,000,000")).toBeInTheDocument(); // the brokerage row
    expect(screen.queryByText("$11,500,000")).toBeNull();
    expect(screen.queryByText("$10,000,000")).toBeNull();
  });
});
