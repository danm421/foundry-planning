// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalDebtList } from "../portal-debt-list";

const plaidRow = {
  id: "l1", name: "Chase Card", balance: 980, liabilityType: "credit_card",
  aprPercentage: 21.99, statementBalance: 980, minimumPayment: 35,
  nextPaymentDueDate: "2026-07-15", isPlaidLinked: true,
};
const manualRow = {
  id: "l2", name: "Auto Loan", balance: 12000, liabilityType: "auto",
  aprPercentage: null, statementBalance: null, minimumPayment: null,
  nextPaymentDueDate: null, isPlaidLinked: false,
};

describe("PortalDebtList", () => {
  it("renders null when there are no debts", () => {
    const { container } = render(<PortalDebtList rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows Plaid metadata for linked rows and omits it for manual rows", () => {
    render(<PortalDebtList rows={[plaidRow, manualRow]} />);
    expect(screen.getByText("Chase Card")).toBeInTheDocument();
    expect(screen.getByText("Auto Loan")).toBeInTheDocument();
    expect(screen.getByText(/21\.99%/)).toBeInTheDocument(); // APR for Plaid row
    expect(screen.getByText(/\$35/)).toBeInTheDocument(); // min payment
    // manual row has no APR text
    expect(screen.queryAllByText(/APR/i).length).toBe(1);
  });
});
