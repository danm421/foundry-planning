import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  liabilities,
  plaidItems,
  plaidTransactions,
  liabilityTypeEnum,
  transactionCategorizedByEnum,
} from "@/db/schema";

describe("Phase 2 schema — liabilities extension", () => {
  const cols = getTableColumns(liabilities);
  it("adds the revolving + Plaid columns", () => {
    for (const c of [
      "liabilityType",
      "minimumPayment",
      "statementBalance",
      "aprPercentage",
      "nextPaymentDueDate",
      "plaidItemId",
      "plaidAccountId",
    ]) {
      expect(cols, `missing ${c}`).toHaveProperty(c);
    }
  });
  it("makes termMonths + monthlyPayment nullable", () => {
    expect(cols.termMonths.notNull).toBe(false);
    expect(cols.monthlyPayment.notNull).toBe(false);
  });
  it("liabilityType enum carries credit_card", () => {
    expect(liabilityTypeEnum.enumValues).toContain("credit_card");
    expect(liabilityTypeEnum.enumValues).toContain("mortgage");
  });
});

describe("Phase 2 schema — plaid_items + plaid_transactions", () => {
  it("plaid_items gains transactionsCursor (nullable)", () => {
    const cols = getTableColumns(plaidItems);
    expect(cols).toHaveProperty("transactionsCursor");
    expect(cols.transactionsCursor.notNull).toBe(false);
  });
  it("plaid_transactions has the core columns + unique plaidTransactionId", () => {
    const cols = getTableColumns(plaidTransactions);
    for (const c of [
      "clientId",
      "plaidItemId",
      "accountId",
      "plaidAccountId",
      "plaidTransactionId",
      "amount",
      "date",
      "merchantName",
      "name",
      "pfcPrimary",
      "pfcDetailed",
      "pfcConfidence",
      "pending",
      "categoryId",
      "categorizedBy",
      "excluded",
    ]) {
      expect(cols, `missing ${c}`).toHaveProperty(c);
    }
    expect(cols.accountId.notNull).toBe(false); // nullable: credit txns map to liabilities
    expect(transactionCategorizedByEnum.enumValues).toEqual(["plaid", "rule", "manual"]);
  });
});
