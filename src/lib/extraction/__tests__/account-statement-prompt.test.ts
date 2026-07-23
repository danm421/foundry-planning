import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATEMENT_PROMPT,
  ACCOUNT_STATEMENT_VERSION,
  buildAccountStatementPrompt,
  ACCOUNT_STATEMENT_HOLDINGS_VERSION,
  buildHoldingsContinuationPrompt,
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

  it("instructs real estate, annuity, and lifePolicies extraction", () => {
    expect(ACCOUNT_STATEMENT_PROMPT).toContain("real_estate");
    expect(ACCOUNT_STATEMENT_PROMPT).toContain("primary_residence");
    expect(ACCOUNT_STATEMENT_PROMPT).toContain("annuity");
    expect(ACCOUNT_STATEMENT_PROMPT).toContain("lifePolicies");
    expect(ACCOUNT_STATEMENT_PROMPT).toContain("cashValue");
    expect(ACCOUNT_STATEMENT_VERSION).toBe("2026-06-10.1");
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

describe("buildAccountStatementPrompt", () => {
  it("base variant has no holdings array", () => {
    const p = buildAccountStatementPrompt(false);
    expect(p).toBe(ACCOUNT_STATEMENT_PROMPT);
    expect(p).not.toContain('"holdings"');
  });

  it("holdings variant documents the per-position fields and rules", () => {
    const p = buildAccountStatementPrompt(true);
    expect(p).toContain('"holdings"');
    expect(p).toContain("ticker");
    expect(p).toContain("costBasis");
    expect(p).toMatch(/CUSIP/i);
    expect(p).toMatch(/cash/i);
  });

  it("holdings version differs from the base version", () => {
    expect(ACCOUNT_STATEMENT_HOLDINGS_VERSION).not.toBe(ACCOUNT_STATEMENT_VERSION);
  });
});

describe("account-statement prompt — education_savings", () => {
  const prompt = buildAccountStatementPrompt(false);

  it("offers education_savings as a category", () => {
    expect(prompt).toContain("education_savings");
  });

  it("routes 529 and Coverdell accounts to it explicitly", () => {
    expect(prompt).toMatch(/529[\s\S]{0,160}education_savings/);
    expect(prompt.toLowerCase()).toContain("coverdell");
  });
});

describe("buildHoldingsContinuationPrompt", () => {
  it("identifies the account and lists captured positions", () => {
    const p = buildHoldingsContinuationPrompt(
      { name: "M. SINGER LP", accountNumberLast4: "3601", value: 2727270 },
      ["AGNC", "ALPHABET INC SHS CL C"],
    );
    expect(p).toContain("M. SINGER LP");
    expect(p).toContain("3601");
    expect(p).toContain("AGNC");
    expect(p).toContain("ALPHABET INC SHS CL C");
    expect(p).toContain('"holdings"');
    expect(p).toMatch(/do not repeat|DO NOT repeat/i);
  });

  it("handles no captured positions", () => {
    const p = buildHoldingsContinuationPrompt({ name: "Acct", value: 100 }, []);
    expect(p).toContain("(none yet)");
    expect(p).toContain('"holdings"');
  });
});
