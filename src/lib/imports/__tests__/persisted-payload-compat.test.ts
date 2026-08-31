// src/lib/imports/__tests__/persisted-payload-compat.test.ts
//
// R1 (whole-branch review, C1). `ImportPayload.savings` was added as a
// REQUIRED section, but `client_imports.payloadJson.payload` rows persisted
// before this branch carry NO `savings` key. Three readers dereference it
// bare — `presenceFromPayload`, `stepHasImportData`, `countRows` — so opening
// any pre-branch import threw `Cannot read properties of undefined (reading
// 'length')`.
//
// 661 tests were blind to that because EVERY ONE of them builds its payload
// with `{ ...emptyImportPayload() }`, which always supplies whichever key was
// just added. This file is deliberately the exception: `PRE_BRANCH` below is a
// hand-written literal that must NEVER be constructed from
// `emptyImportPayload()`, or it stops testing anything.
//
// This is the THIRD instance of the class (`expenseSlots.role`, `goals`, then
// `savings`), which is why the fix is a type — `PersistedImportPayload` +
// `normalizeImportPayload` — rather than scattered `?? []`.

import { describe, it, expect, vi } from "vitest";

// `run-assemble.ts` imports the real db client at module load; nothing here
// touches it (only `countRows`, a pure function).
vi.mock("@/db", () => ({ db: {} }));

import {
  normalizeImportPayload,
  type ImportPayload,
  type PersistedImportPayload,
} from "../types";
import { presenceFromPayload } from "../required-tabs";
import { stepHasImportData } from "@/lib/onboarding/import-sections";
import { countRows } from "../assemble/run-assemble";
import { mergeExtractionResults } from "../merge";
import { mergeAcrossFiles } from "../assemble/merge-across-files";
import type { ExtractionResult } from "@/lib/extraction/types";

/**
 * A `payloadJson.payload` exactly as a pre-branch import left it on disk:
 * every section that existed then, and NO `savings` key and NO `goals` key.
 * Written out by hand on purpose — see the file header.
 */
const PRE_BRANCH: PersistedImportPayload = {
  primary: { firstName: "Ada", lastName: "Lovelace" },
  dependents: [],
  accounts: [
    { name: "401(k)", custodian: "Fidelity", value: 250_000, category: "retirement" },
    { name: "Joint Brokerage", custodian: "Schwab", value: 80_000, category: "taxable" },
  ],
  incomes: [{ name: "Salary", type: "salary", annualAmount: 200_000 }],
  expenses: [],
  liabilities: [],
  lifePolicies: [],
  wills: [],
  entities: [],
  warnings: ["one pre-existing warning"],
};

/** Same pre-branch shape, but with the accounts section empty. */
const PRE_BRANCH_NO_ACCOUNTS = { ...PRE_BRANCH, accounts: [] };

describe("R1 — the fixture itself (assert the instrument)", () => {
  it("carries no `savings` key at all", () => {
    expect("savings" in PRE_BRANCH).toBe(false);
  });

  it("carries no `goals` key at all", () => {
    expect("goals" in PRE_BRANCH).toBe(false);
  });

  it("stays savings-less after the no-accounts variant is derived from it", () => {
    expect("savings" in PRE_BRANCH_NO_ACCOUNTS).toBe(false);
  });
});

describe("R1 — the raw persisted payload is the production crash", () => {
  // These three pin WHY the normalizer is load-bearing: hand any reader the
  // on-disk shape directly and it throws. `PersistedImportPayload` makes each
  // of these casts the compile error it should always have been.
  it("presenceFromPayload throws on the raw pre-branch payload", () => {
    expect(() =>
      presenceFromPayload(PRE_BRANCH as unknown as ImportPayload),
    ).toThrow(/Cannot read properties of undefined \(reading 'length'\)/);
  });

  it("stepHasImportData('accounts') throws on a raw pre-branch payload with no accounts", () => {
    // The accounts step is `accounts.length > 0 || savings.length > 0`, so `||`
    // SHORT-CIRCUITS whenever the document produced an account — which is why
    // this crash reached production looking intermittent. It only fires on an
    // import whose accounts section is empty.
    expect(() =>
      stepHasImportData(PRE_BRANCH_NO_ACCOUNTS as unknown as ImportPayload, "accounts"),
    ).toThrow(/Cannot read properties of undefined \(reading 'length'\)/);
  });

  it("stepHasImportData('accounts') short-circuits past the missing key when accounts exist", () => {
    // Pins the short-circuit as a fact rather than an assumption: the sibling
    // test above depends on it, and this is what made the bug intermittent.
    expect(
      stepHasImportData(PRE_BRANCH as unknown as ImportPayload, "accounts"),
    ).toBe(true);
  });

  it("countRows throws on the raw pre-branch payload", () => {
    expect(() => countRows(PRE_BRANCH as unknown as ImportPayload)).toThrow(
      /Cannot read properties of undefined \(reading 'length'\)/,
    );
  });
});

describe("R1 — normalizeImportPayload is the boundary", () => {
  it("fills every section the pre-branch payload omits", () => {
    const p = normalizeImportPayload(PRE_BRANCH);
    expect(p.savings).toEqual([]);
    expect(p.goals).toBeUndefined();
  });

  it("fills a section that is missing from a payload with NOTHING in it", () => {
    // The degenerate on-disk shape: `{}`. Every array must still be present.
    const p = normalizeImportPayload({});
    expect(p.dependents).toEqual([]);
    expect(p.accounts).toEqual([]);
    expect(p.incomes).toEqual([]);
    expect(p.expenses).toEqual([]);
    expect(p.liabilities).toEqual([]);
    expect(p.lifePolicies).toEqual([]);
    expect(p.wills).toEqual([]);
    expect(p.entities).toEqual([]);
    expect(p.savings).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it("preserves the sections the pre-branch payload DID carry", () => {
    const p = normalizeImportPayload(PRE_BRANCH);
    expect(p.accounts).toHaveLength(2);
    expect(p.incomes).toHaveLength(1);
    expect(p.warnings).toEqual(["one pre-existing warning"]);
    expect(p.primary?.firstName).toBe("Ada");
  });

  it("replaces an explicit null section with an empty array", () => {
    // A bare double spread would copy `null` straight through and the readers
    // would still throw — this is what the per-key coercion buys.
    const p = normalizeImportPayload({
      savings: null,
      accounts: null,
    } as unknown as PersistedImportPayload);
    expect(p.savings).toEqual([]);
    expect(p.accounts).toEqual([]);
  });

  it("returns a fully-formed payload for null/undefined input", () => {
    expect(normalizeImportPayload(null).savings).toEqual([]);
    expect(normalizeImportPayload(undefined).savings).toEqual([]);
  });
});

describe("R1 — the three readers survive a normalized pre-branch payload", () => {
  const normalized = normalizeImportPayload(PRE_BRANCH);

  it("presenceFromPayload reports savings and goals absent, accounts present", () => {
    const presence = presenceFromPayload(normalized);
    expect(presence.savings).toBe(false);
    expect(presence.goals).toBe(false);
    expect(presence.accounts).toBe(true);
    expect(presence.family).toBe(true);
  });

  it("stepHasImportData answers every eligible step", () => {
    expect(stepHasImportData(normalized, "accounts")).toBe(true);
    expect(stepHasImportData(normalized, "cash-flow")).toBe(true);
    expect(stepHasImportData(normalized, "family")).toBe(true);
    expect(stepHasImportData(normalized, "liabilities")).toBe(false);
    expect(stepHasImportData(normalized, "insurance")).toBe(false);
  });

  it("countRows counts the rows that are there", () => {
    // 2 accounts + 1 income, and 0 for every absent section.
    expect(countRows(normalized)).toBe(3);
  });
});

// The same hazard one layer up, found while wiring R3's savings loop.
// `extracted.savings` was added to `ExtractionResult` by THIS BRANCH alone
// (`0038b216f`, not on main), and both merge functions are fed a PERSISTED
// `payloadJson.fileResults` entry straight off the column (`match/route.ts` and
// `assemble/route.ts`). So a fileResults row written before this branch has no
// `savings` key, and bare iteration crashes `/match` and `/assemble` on exactly
// the pre-branch imports R1 exists to protect. The type says
// `ExtractedSavings[]`, so only a runtime guard catches it — which is why the
// fixture below is a cast, exactly as the persisted column is.
describe("a pre-branch ExtractionResult has no `savings` key either", () => {
  /** `fileResults[x]` as a pre-branch extraction left it on disk. */
  const PRE_BRANCH_RESULT = {
    documentType: "fact_finder",
    fileName: "old.pdf",
    promptVersion: "test:1.0",
    warnings: [],
    extracted: {
      accounts: [{ name: "Schwab", value: 100_000 }],
      incomes: [],
      expenses: [],
      liabilities: [],
      entities: [],
      lifePolicies: [],
      wills: [],
      // no `savings`, no `goals`
    },
  } as unknown as ExtractionResult;

  it("the fixture carries no `savings` key (assert the instrument)", () => {
    expect("savings" in PRE_BRANCH_RESULT.extracted).toBe(false);
  });

  it("mergeExtractionResults survives it and yields an empty savings section", () => {
    const out = mergeExtractionResults([{ fileId: "f1", result: PRE_BRANCH_RESULT }]);
    expect(out.savings).toEqual([]);
    // The sections that WERE persisted still come through.
    expect(out.accounts).toHaveLength(1);
  });

  it("mergeAcrossFiles survives it and yields an empty savings section", () => {
    const { payload } = mergeAcrossFiles({ f1: PRE_BRANCH_RESULT });
    expect(payload.savings).toEqual([]);
    expect(payload.accounts).toHaveLength(1);
  });
});

import type { ExtractedIncome, ExtractedSavings } from "@/lib/extraction/types";

describe("reconciliation fact fields", () => {
  it("accepts an income row carrying the new optional facts", () => {
    const row: ExtractedIncome = {
      type: "salary",
      name: "Rachel Marie Sheskier - Salary at The Mount Sinai Hospital",
      annualAmount: 239_549.96,
      employer: "The Mount Sinai Hospital",
      sourceTaxYear: 2026,
      basis: "annualized",
      recurrence: "recurring",
    };
    expect(row.employer).toBe("The Mount Sinai Hospital");
    expect(row.basis).toBe("annualized");
  });

  it("accepts a savings row carrying employer", () => {
    const row: ExtractedSavings = {
      name: "TSA 403B",
      destinationAccountName: "The Mount Sinai Hospital 403(b)",
      employer: "The Mount Sinai Hospital",
      annualAmount: 26_000,
      contributionRole: "employee",
    };
    expect(row.employer).toBe("The Mount Sinai Hospital");
  });

  it("still accepts a row with none of them (pre-change payloads)", () => {
    const row: ExtractedIncome = { type: "salary", name: "Legacy", annualAmount: 1 };
    expect(row.employer).toBeUndefined();
    expect(row.sourceTaxYear).toBeUndefined();
  });
});
