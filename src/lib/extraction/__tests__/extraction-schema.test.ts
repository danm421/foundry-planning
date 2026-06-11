import { describe, expect, it } from "vitest";
import { extractedPayloadSchema } from "../extraction-schema";

describe("extractedPayloadSchema holdings", () => {
  it("accepts an account with a holdings array", () => {
    const r = extractedPayloadSchema.safeParse({
      accounts: [
        {
          name: "Schwab Brokerage",
          category: "taxable",
          value: 2000,
          holdings: [{ ticker: "VTI", shares: 10, price: 200, costBasis: 1500 }],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an oversize holdings array (> 300)", () => {
    const holdings = Array.from({ length: 301 }, () => ({ ticker: "VTI", shares: 1 }));
    const r = extractedPayloadSchema.safeParse({
      accounts: [{ name: "Big", holdings }],
    });
    expect(r.success).toBe(false);
  });

  it("still accepts accounts with no holdings", () => {
    const r = extractedPayloadSchema.safeParse({
      accounts: [{ name: "Cash", category: "cash", value: 100 }],
    });
    expect(r.success).toBe(true);
  });
});
