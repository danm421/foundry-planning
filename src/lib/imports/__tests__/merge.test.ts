import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@/lib/extraction/types";
import { mergeExtractionResults } from "../merge";

function emptyExtracted(): ExtractionResult["extracted"] {
  return {
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    entities: [],
    lifePolicies: [],
    wills: [],
    savings: [],
    goals: [],
  };
}

function makeResult(
  overrides: Partial<ExtractionResult["extracted"]>,
  warnings: string[] = [],
): ExtractionResult {
  return {
    documentType: "fact_finder",
    fileName: "test.pdf",
    extracted: { ...emptyExtracted(), ...overrides },
    warnings,
    promptVersion: "test:1.0",
  };
}

describe("mergeExtractionResults", () => {
  it("returns the empty payload when no files are provided", () => {
    const out = mergeExtractionResults([]);
    expect(out.accounts).toEqual([]);
    expect(out.dependents).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.primary).toBeUndefined();
    expect(out.spouse).toBeUndefined();
  });

  it("annotates every row with sourceFileId and match: new", () => {
    const out = mergeExtractionResults([
      {
        fileId: "file-1",
        result: makeResult({
          accounts: [{ name: "Schwab", value: 100000 }],
          incomes: [{ name: "Salary", annualAmount: 80000 }],
        }),
      },
    ]);
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0].__provenance?.sourceFileId).toBe("file-1");
    expect(out.accounts[0].__provenance?.section).toBe("accounts");
    expect(out.accounts[0].match).toEqual({ kind: "new" });
    expect(out.incomes[0].__provenance?.sourceFileId).toBe("file-1");
  });

  it("preserves multi-pass __provenance section + pageRange and overlays sourceFileId", () => {
    const accountRow = {
      name: "Joint Brokerage",
      value: 50000,
      __provenance: { section: "accounts", pageRange: [8, 10] as [number, number] },
    };
    const out = mergeExtractionResults([
      {
        fileId: "file-A",
        result: makeResult({ accounts: [accountRow] }),
      },
    ]);
    expect(out.accounts[0].__provenance).toEqual({
      sourceFileId: "file-A",
      section: "accounts",
      pageRange: [8, 10],
    });
  });

  it("flattens dependents from family payload to the top-level dependents array", () => {
    const out = mergeExtractionResults([
      {
        fileId: "ff-1",
        result: makeResult({
          family: {
            primary: { firstName: "John", lastName: "Smith" },
            spouse: { firstName: "Jane", lastName: "Smith" },
            dependents: [
              { firstName: "Sam", relationship: "child", role: "child" },
              { firstName: "Lily", relationship: "child", role: "child" },
            ],
          },
        }),
      },
    ]);
    expect(out.primary?.firstName).toBe("John");
    expect(out.spouse?.firstName).toBe("Jane");
    expect(out.dependents).toHaveLength(2);
    expect(out.dependents[0].__provenance?.section).toBe("family");
    expect(out.dependents[0].match).toEqual({ kind: "new" });
  });

  it("keeps the first non-empty primary/spouse and warns on conflict", () => {
    const out = mergeExtractionResults([
      {
        fileId: "ff-1",
        result: makeResult({
          family: { primary: { firstName: "John", lastName: "Smith" } },
        }),
      },
      {
        fileId: "ff-2",
        result: makeResult({
          family: { primary: { firstName: "Jonathan", lastName: "Smith" } },
        }),
      },
    ]);
    expect(out.primary?.firstName).toBe("John");
    expect(
      out.warnings.some((w) => w.toLowerCase().includes("primary client conflict")),
    ).toBe(true);
  });

  it("does not warn when the second file has the same primary (case insensitive)", () => {
    const out = mergeExtractionResults([
      {
        fileId: "ff-1",
        result: makeResult({
          family: { primary: { firstName: "John", lastName: "Smith" } },
        }),
      },
      {
        fileId: "ff-2",
        result: makeResult({
          family: { primary: { firstName: "JOHN", lastName: "SMITH" } },
        }),
      },
    ]);
    expect(
      out.warnings.some((w) => w.toLowerCase().includes("conflict")),
    ).toBe(false);
  });

  it("forwards lifePolicies and wills with provenance + match", () => {
    const out = mergeExtractionResults([
      {
        fileId: "ff-1",
        result: makeResult({
          lifePolicies: [
            {
              policyType: "term",
              insuredPerson: "client",
              faceValue: 1000000,
              accountName: "Term — 1234",
            },
          ],
          wills: [{ grantor: "client", bequests: [] }],
        }),
      },
    ]);
    expect(out.lifePolicies).toHaveLength(1);
    expect(out.lifePolicies[0].__provenance?.sourceFileId).toBe("ff-1");
    expect(out.lifePolicies[0].match).toEqual({ kind: "new" });
    expect(out.wills).toHaveLength(1);
    expect(out.wills[0].grantor).toBe("client");
  });

  it("concatenates warnings from each file into a single array", () => {
    const out = mergeExtractionResults([
      { fileId: "f1", result: makeResult({}, ["warn-a"]) },
      { fileId: "f2", result: makeResult({}, ["warn-b", "warn-c"]) },
    ]);
    expect(out.warnings).toEqual(["warn-a", "warn-b", "warn-c"]);
  });

  it("merges arrays from multiple files in declaration order", () => {
    const out = mergeExtractionResults([
      {
        fileId: "f1",
        result: makeResult({ accounts: [{ name: "Schwab", value: 100 }] }),
      },
      {
        fileId: "f2",
        result: makeResult({ accounts: [{ name: "Fidelity", value: 200 }] }),
      },
    ]);
    expect(out.accounts).toHaveLength(2);
    expect(out.accounts[0].name).toBe("Schwab");
    expect(out.accounts[0].__provenance?.sourceFileId).toBe("f1");
    expect(out.accounts[1].name).toBe("Fidelity");
    expect(out.accounts[1].__provenance?.sourceFileId).toBe("f2");
  });

  // R3 (whole-branch review, I1). `mergeExtractionResults` copied seven
  // sections and skipped savings entirely, so savings rows were inert on THREE
  // of the four import paths: this function backs `run-matching.ts` and so the
  // `/match` route, which is Details→Import→Extract, the onboarding drawer,
  // and Forge mode "updating". Only Forge mode "new" (`mergeAcrossFiles`)
  // copied them — while the savings extraction pass ran, and was billed, on
  // every path.
  describe("savings", () => {
    const employee = {
      name: "401(k) deferral",
      destinationAccountName: "Zach 401(k)",
      owner: "client" as const,
      annualPercent: 0.1,
      contributionRole: "employee" as const,
    };
    const employer = {
      name: "401(k) match",
      destinationAccountName: "Zach 401(k)",
      owner: "client" as const,
      employerMatchPct: 1,
      employerMatchCap: 0.04,
      contributionRole: "employer" as const,
    };
    const spouseIra = {
      name: "Roth IRA",
      destinationAccountName: "Ashley Roth IRA",
      owner: "spouse" as const,
      annualAmount: 7000,
    };

    it("copies savings rows from every file, in file order", () => {
      const out = mergeExtractionResults([
        { fileId: "f1", result: makeResult({ savings: [employee, employer] }) },
        { fileId: "f2", result: makeResult({ savings: [spouseIra] }) },
      ]);
      expect(out.savings).toHaveLength(3);
      expect(out.savings.map((r) => r.name)).toEqual([
        "401(k) deferral",
        "401(k) match",
        "Roth IRA",
      ]);
    });

    it("stamps each savings row with its own file's sourceFileId", () => {
      const out = mergeExtractionResults([
        { fileId: "f1", result: makeResult({ savings: [employee, employer] }) },
        { fileId: "f2", result: makeResult({ savings: [spouseIra] }) },
      ]);
      expect(out.savings.map((r) => r.__provenance?.sourceFileId)).toEqual([
        "f1",
        "f1",
        "f2",
      ]);
    });

    it("stamps section 'savings' and match kind 'new' on each row", () => {
      const out = mergeExtractionResults([
        { fileId: "f1", result: makeResult({ savings: [employee] }) },
      ]);
      expect(out.savings[0].__provenance?.section).toBe("savings");
      // Correct kind: a savings row resolves to an ACCOUNT by name at commit,
      // it is never matched against an existing savings_rules row.
      expect(out.savings[0].match).toEqual({ kind: "new" });
    });

    it("preserves the engine fields the commit step reads", () => {
      const out = mergeExtractionResults([
        { fileId: "f1", result: makeResult({ savings: [employee, employer] }) },
      ]);
      expect(out.savings[0]).toMatchObject({
        destinationAccountName: "Zach 401(k)",
        annualPercent: 0.1,
        contributionRole: "employee",
      });
      expect(out.savings[1]).toMatchObject({
        employerMatchPct: 1,
        employerMatchCap: 0.04,
        contributionRole: "employer",
      });
    });
  });
});
