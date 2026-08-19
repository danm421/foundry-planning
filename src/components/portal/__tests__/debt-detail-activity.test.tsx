// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DebtDetailPanel } from "@/components/portal/account-detail-panel";

const fetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => fetchMock,
}));

const card = {
  id: "liab-1",
  name: "Ultimate Rewards®",
  balance: 2654,
  typeLabel: "Credit card",
  aprPercentage: 24.49,
  statementBalance: 3465,
  minimumPayment: 40,
  nextPaymentDueDate: "2026-09-15",
  interestRate: null,
  monthlyPayment: null,
  payoffYear: null,
  isPlaidLinked: true,
  ownerLabel: "Household",
  showActivity: true,
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => fetchMock.mockReset());

it("lists a credit card's transactions, asking by liability id", async () => {
  fetchMock.mockResolvedValue(
    ok({
      transactions: [
        { id: "t1", date: "2026-08-14", name: "SQ *COFFEE", merchantName: "Blue Bottle", amount: "12.40" },
        { id: "t2", date: "2026-08-02", name: "PAYMENT THANK YOU", merchantName: null, amount: "-500.00" },
      ],
    }),
  );
  render(<DebtDetailPanel debt={card} onClose={() => {}} />);

  await waitFor(() => expect(screen.getByText("Blue Bottle")).toBeTruthy());
  // A card's rows carry no accountId, so asking by accountId would return the
  // household's whole list — the liability id is what makes this panel correct.
  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain("liabilityId=liab-1");
  expect(url).not.toContain("accountId=");
  // Plaid signs a payment negative; it must read as money in, not another charge.
  expect(screen.getByText("+$500")).toBeTruthy();
});

it("says so plainly when the card has synced nothing yet", async () => {
  fetchMock.mockResolvedValue(ok({ transactions: [] }));
  render(<DebtDetailPanel debt={card} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText(/No transactions/i)).toBeTruthy());
});

it("repeats the server's reason on a 403 instead of guessing privacy", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ error: "Your advisor has not enabled Budget for this portal" }),
  });
  render(<DebtDetailPanel debt={card} onClose={() => {}} />);
  await waitFor(() =>
    expect(screen.getByText("Your advisor has not enabled Budget for this portal")).toBeTruthy(),
  );
});

it("omits the section entirely for a debt that can never carry transactions", () => {
  render(<DebtDetailPanel debt={{ ...card, showActivity: false }} onClose={() => {}} />);
  expect(screen.queryByText("Recent activity")).toBeNull();
  // No heading means no fetch — an empty promise costs a request too.
  expect(fetchMock).not.toHaveBeenCalled();
});
