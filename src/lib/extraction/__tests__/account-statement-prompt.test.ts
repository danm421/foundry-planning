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
    expect(ACCOUNT_STATEMENT_VERSION).toBe("2026-08-04.2");
  });

  it("instructs a short account-TYPE name with no custodian, not the registration header", () => {
    expect(ACCOUNT_STATEMENT_PROMPT).toMatch(/SHORT/);
    expect(ACCOUNT_STATEMENT_PROMPT).toMatch(/Do NOT put the custodian in "name"/);
    // "Fidelity Rollover IRA" survives only as the counter-example.
    expect(ACCOUNT_STATEMENT_PROMPT).toMatch(/Bad: "Fidelity Rollover IRA"/);
    // The registration line and the account number have their own fields, so
    // neither belongs in "name".
    expect(ACCOUNT_STATEMENT_PROMPT).toMatch(
      /Never copy the statement's registration header into "name"/,
    );
  });

  it("forbids guessing a custodian the document never names", () => {
    expect(ACCOUNT_STATEMENT_PROMPT).toMatch(/never guess or infer one/i);
    expect(ACCOUNT_STATEMENT_PROMPT).toMatch(/Fact finders/i);
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

  // A planning-software "Holdings Detail" report groups every position under an
  // account HEADER row and runs the table across page breaks without repeating
  // it — and can list two accounts whose type name is identical ("Taxable
  // Account"), separable only by the last 4. Without these rules the model has
  // no instruction telling it which account a position belongs to.
  describe("grouped holdings-report rules", () => {
    const p = buildAccountStatementPrompt(true);

    it("binds a position to the account header above it", () => {
      expect(p).toMatch(/nearest account header ABOVE it/i);
    });

    it("carries that header across an unrepeated page break", () => {
      expect(p).toMatch(/continues onto the next page/i);
      expect(p).toMatch(/do not start a new account at a page break/i);
    });

    it("keeps same-named accounts apart by their last 4", () => {
      expect(p).toMatch(/"accountNumberLast4" differ/i);
      expect(p).toMatch(/never merge/i);
    });

    it("excludes the report-level total and cash-balance footer rows", () => {
      expect(p).toMatch(/Total Holdings/);
      expect(p).toMatch(/not a position/i);
    });

    it("derives a missing account value from its own positions only", () => {
      expect(p).toMatch(/sum of its own positions/i);
      expect(p).toMatch(/portfolio-wide total/i);
    });
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
