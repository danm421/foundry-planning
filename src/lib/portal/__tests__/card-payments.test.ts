import { describe, it, expect } from "vitest";
import { cardPaymentTransferIds, type CardPaymentRow } from "@/lib/portal/card-payments";

const CARD = "plaid-card";
const CHECKING = "plaid-checking";
const cards = new Set([CARD]);

function row(over: Partial<CardPaymentRow> & Pick<CardPaymentRow, "id">): CardPaymentRow {
  return {
    plaidAccountId: CHECKING,
    amount: 500,
    date: "2026-09-02",
    type: "expense",
    pfcPrimary: "LOAN_PAYMENTS",
    pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    ...over,
  };
}
const received = (over: Partial<CardPaymentRow> & Pick<CardPaymentRow, "id">) =>
  row({ plaidAccountId: CARD, amount: -500, ...over });

describe("cardPaymentTransferIds", () => {
  it("makes a linked card's payment-received a transfer even with no checking side", () => {
    // Card-only household: the payment would otherwise net the card's purchases away.
    expect(cardPaymentTransferIds([received({ id: "r" })], cards)).toEqual(["r"]);
  });

  it("makes both sides a transfer when checking pays a linked card", () => {
    const rows = [row({ id: "p", date: "2026-09-02" }), received({ id: "r", date: "2026-09-01" })];
    expect(cardPaymentTransferIds(rows, cards).sort()).toEqual(["p", "r"]);
  });

  it("keeps a payment to an unlinked card as spending", () => {
    expect(cardPaymentTransferIds([row({ id: "p" })], cards)).toEqual([]);
  });

  it("pairs across a month end", () => {
    const rows = [row({ id: "p", date: "2026-08-02" }), received({ id: "r", date: "2026-07-31" })];
    expect(cardPaymentTransferIds(rows, cards).sort()).toEqual(["p", "r"]);
  });

  it("does not pair amounts a cent apart", () => {
    const rows = [row({ id: "p", amount: 500.01 }), received({ id: "r" })];
    expect(cardPaymentTransferIds(rows, cards)).toEqual(["r"]);
  });

  it("does not pair more than 5 days apart", () => {
    const rows = [row({ id: "p", date: "2026-09-08" }), received({ id: "r", date: "2026-09-02" })];
    expect(cardPaymentTransferIds(rows, cards)).toEqual(["r"]);
  });

  it("pairs one-to-one, closest date first", () => {
    const rows = [
      // `far` is earlier, so a by-date sweep would hand it the card side first.
      row({ id: "far", date: "2026-08-28" }),
      row({ id: "near", date: "2026-09-02" }),
      received({ id: "r", date: "2026-09-01" }),
    ];
    expect(cardPaymentTransferIds(rows, cards).sort()).toEqual(["near", "r"]);
  });

  it("heals a pair where the client re-typed only the checking side", () => {
    // Prod, July 2026: checking side moved to Transfer, card side left as expense.
    const rows = [row({ id: "p", type: "transfer" }), received({ id: "r" })];
    expect(cardPaymentTransferIds(rows, cards)).toEqual(["r"]);
  });

  it("heals a pair where the client re-typed only the card side", () => {
    // Prod, August 2026: card side moved to Transfer, checking side left as expense.
    const rows = [row({ id: "p" }), received({ id: "r", type: "transfer" })];
    expect(cardPaymentTransferIds(rows, cards)).toEqual(["p"]);
  });

  it("pairs a card side Plaid tagged TRANSFER_IN", () => {
    const rows = [
      row({ id: "p" }),
      received({ id: "r", type: "transfer", pfcPrimary: "TRANSFER_IN", pfcDetailed: "TRANSFER_IN_OTHER_TRANSFER_IN" }),
    ];
    expect(cardPaymentTransferIds(rows, cards)).toEqual(["p"]);
  });

  it("pairs a paying side Plaid filed under another loan detail", () => {
    const rows = [row({ id: "p", pfcDetailed: "LOAN_PAYMENTS_OTHER_PAYMENT" }), received({ id: "r" })];
    expect(cardPaymentTransferIds(rows, cards).sort()).toEqual(["p", "r"]);
  });

  it("keeps an unpaired mortgage payment as spending", () => {
    const rows = [row({ id: "m", amount: 2151.29, pfcDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" })];
    expect(cardPaymentTransferIds(rows, cards)).toEqual([]);
  });

  it("leaves a card refund and a returned payment alone", () => {
    const rows = [
      received({ id: "refund", pfcPrimary: "GENERAL_MERCHANDISE", pfcDetailed: "GENERAL_MERCHANDISE_OTHER" }),
      row({ id: "returned", plaidAccountId: CARD, amount: 500 }),
    ];
    expect(cardPaymentTransferIds(rows, cards)).toEqual([]);
  });
});
