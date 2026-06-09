// src/lib/flows-ledger/build-flows-ledger.test.ts
import { describe, it, expect } from "vitest";
import type { AccountLedger, ProjectionYear } from "@/engine/types";
import { buildFlowsLedger } from "./build-flows-ledger";
import type { FlowsLedgerContext } from "./types";

/** Fill an AccountLedger with zero defaults, override what the test cares about. */
function mkLedger(p: Partial<AccountLedger>): AccountLedger {
  return {
    beginningValue: 0,
    growth: 0,
    contributions: 0,
    distributions: 0,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount: 0,
    fees: 0,
    endingValue: 0,
    entries: [],
    ...p,
  };
}

/** Minimal ProjectionYear — buildFlowsLedger reads only year/ages/accountLedgers. */
function mkYear(accountLedgers: Record<string, AccountLedger>): ProjectionYear {
  return {
    year: 2031,
    ages: { client: 64, spouse: 62 },
    accountLedgers,
  } as unknown as ProjectionYear;
}

const ctx: FlowsLedgerContext = {
  accountNames: { brokerage: "Joint Brokerage", ira: "John IRA", trustAcct: "Trust Brokerage" },
  accountCategories: { brokerage: "taxable", ira: "retirement", trustAcct: "taxable" },
  entityNames: { ent1: "Smith Family Trust" },
  entityKinds: { ent1: "trust" },
  accountEntityOwners: new Map([["trustAcct", { entityId: "ent1", percent: 1 }]]),
};

describe("buildFlowsLedger", () => {
  const year = mkYear({
    brokerage: mkLedger({
      beginningValue: 500_000,
      growth: 32_000,
      contributions: 12_000,
      endingValue: 537_000,
      entries: [
        { category: "growth", label: "Growth", amount: 32_000 },
        { category: "savings_contribution", label: "Savings", amount: 12_000 },
        { category: "withdrawal", label: "Supplemental withdrawal", amount: -7_000, isInternalTransfer: true },
      ],
    }),
    ira: mkLedger({
      beginningValue: 300_000,
      growth: 21_000,
      rmdAmount: 14_000,
      endingValue: 307_000,
      entries: [
        { category: "growth", label: "Growth", amount: 21_000 },
        { category: "rmd", label: "RMD", amount: -14_000 },
      ],
    }),
    trustAcct: mkLedger({
      beginningValue: 100_000,
      growth: 5_000,
      endingValue: 105_000,
      entries: [{ category: "growth", label: "Growth", amount: 5_000 }],
    }),
  });

  it("groups household accounts under Household and entity accounts under the entity", () => {
    const ledger = buildFlowsLedger(year, ctx);
    expect(ledger.sections.map((s) => s.label)).toEqual(["Household", "Smith Family Trust"]);
    expect(ledger.sections[0].kind).toBe("household");
    expect(ledger.sections[0].accounts.map((a) => a.name)).toEqual(["John IRA", "Joint Brokerage"]); // retirement < taxable by category
    expect(ledger.sections[1].kind).toBe("trust");
    expect(ledger.sections[1].accounts.map((a) => a.name)).toEqual(["Trust Brokerage"]);
  });

  it("maps entries to signed rows, plumbs the internal-transfer flag", () => {
    const ledger = buildFlowsLedger(year, ctx);
    const brokerage = ledger.sections[0].accounts.find((a) => a.name === "Joint Brokerage")!;
    expect(brokerage.rows).toHaveLength(3);
    const wd = brokerage.rows.find((r) => r.category === "withdrawal")!;
    expect(wd.amount).toBe(-7_000);
    expect(wd.internal).toBe(true);
    expect(brokerage.rows.find((r) => r.category === "growth")!.internal).toBe(false);
  });

  it("surfaces summary figures and net change", () => {
    const ledger = buildFlowsLedger(year, ctx);
    const ira = ledger.sections[0].accounts.find((a) => a.name === "John IRA")!;
    expect(ira.summary.growth).toBe(21_000);
    expect(ira.summary.rmd).toBe(14_000);
    expect(ira.netChange).toBe(7_000);
  });

  it("reconciles when entries sum to ending − beginning", () => {
    const ledger = buildFlowsLedger(year, ctx);
    for (const s of ledger.sections) {
      for (const a of s.accounts) {
        expect(a.reconciles, a.name).toBe(true);
        expect(a.residual, a.name).toBe(0);
      }
    }
  });

  it("flags an account whose entries do not sum to its ending value", () => {
    const broken = mkYear({
      brokerage: mkLedger({
        beginningValue: 100_000,
        endingValue: 120_000, // claims +20k...
        entries: [{ category: "growth", label: "Growth", amount: 5_000 }], // ...but entries only +5k
      }),
    });
    const ledger = buildFlowsLedger(broken, ctx);
    const block = ledger.sections[0].accounts[0];
    expect(block.reconciles).toBe(false);
    expect(block.residual).toBe(15_000);
  });

  it("skips fully-empty accounts (no balance, no entries)", () => {
    const withEmpty = mkYear({
      brokerage: mkLedger({ beginningValue: 0, endingValue: 0, entries: [] }),
      ira: mkLedger({ beginningValue: 1, endingValue: 1, entries: [{ category: "growth", label: "Growth", amount: 0 }] }),
    });
    const ledger = buildFlowsLedger(withEmpty, ctx);
    const names = ledger.sections.flatMap((s) => s.accounts.map((a) => a.name));
    expect(names).toEqual(["John IRA"]);
  });

  it("labels an unknown-entity owner with its raw id rather than dropping it", () => {
    const orphanCtx: FlowsLedgerContext = {
      ...ctx,
      entityNames: {}, // entity not in the map
      entityKinds: {},
      accountEntityOwners: new Map([["brokerage", { entityId: "ghost", percent: 1 }]]),
    };
    const y = mkYear({ brokerage: mkLedger({ beginningValue: 10, endingValue: 10, entries: [{ category: "growth", label: "Growth", amount: 0 }] }) });
    const ledger = buildFlowsLedger(y, orphanCtx);
    expect(ledger.sections.map((s) => s.label)).toEqual(["ghost"]);
    expect(ledger.sections[0].kind).toBe("business"); // default kind
  });
});
