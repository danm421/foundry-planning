import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATEMENT_PROMPT,
  ACCOUNT_STATEMENT_VERSION,
} from "../prompts/account-statement";
import { extractedPayloadSchema } from "../extraction-schema";

describe("ACCOUNT_STATEMENT_PROMPT", () => {
  it("declares the bumped version (>= 2026-04-29.2 once last4+custodian shipped)", () => {
    expect(ACCOUNT_STATEMENT_VERSION >= "2026-04-29.2").toBe(true);
  });

  it("documents accountNumberLast4 with last-4 instruction", () => {
    expect(ACCOUNT_STATEMENT_PROMPT).toContain("accountNumberLast4");
    expect(ACCOUNT_STATEMENT_PROMPT).toMatch(/last 4|four/i);
  });

  it("documents custodian extraction", () => {
    expect(ACCOUNT_STATEMENT_PROMPT).toContain("custodian");
    expect(ACCOUNT_STATEMENT_PROMPT).toMatch(/Fidelity|Schwab|Vanguard/);
  });

  it("payload with accountNumberLast4 + custodian validates", () => {
    const result = extractedPayloadSchema.safeParse({
      accounts: [
        {
          name: "Schwab Brokerage - Joint",
          category: "taxable",
          subType: "brokerage",
          owner: "joint",
          value: 250000,
          accountNumberLast4: "4321",
          custodian: "Charles Schwab",
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
