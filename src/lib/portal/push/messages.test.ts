import { describe, it, expect } from "vitest";
import {
  buildTransactionsMessage,
  buildReconnectMessage,
  TRANSACTIONS_ROUTE,
} from "./messages";

describe("buildTransactionsMessage", () => {
  it("pluralizes and carries the to-review deep-link", () => {
    const m = buildTransactionsMessage(3);
    expect(m.body).toBe("You have 3 new transactions to review.");
    expect(m.data).toEqual({ kind: "transactions_to_review", route: TRANSACTIONS_ROUTE });
  });
  it("uses the singular noun for a count of 1", () => {
    expect(buildTransactionsMessage(1).body).toBe("You have 1 new transaction to review.");
  });
});

describe("buildReconnectMessage", () => {
  it("names the bank and deep-links to the item manage modal", () => {
    const m = buildReconnectMessage("Chase", "item-42");
    expect(m.body).toBe("Your Chase connection needs attention. Tap to reconnect.");
    expect(m.data).toEqual({ kind: "reconnect_required", route: "/plaid/item-42", itemId: "item-42" });
  });
  it("falls back to 'your bank' when the institution name is null", () => {
    expect(buildReconnectMessage(null, "item-9").body).toBe(
      "Your bank connection needs attention. Tap to reconnect.",
    );
  });
});
