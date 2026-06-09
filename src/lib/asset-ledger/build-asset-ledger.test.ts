// src/lib/asset-ledger/build-asset-ledger.test.ts
import { describe, it, expect } from "vitest";
import type { AccountLedger, ProjectionYear } from "@/engine/types";
import { buildAssetLedger } from "./build-asset-ledger";
import type { AssetLedgerContext } from "./types";

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
    basisBoY: 0,
    basisEoY: 0,
    entries: [],
    ...p,
  };
}

/** Minimal ProjectionYear — buildAssetLedger reads only year/ages/accountLedgers. */
function mkYear(accountLedgers: Record<string, AccountLedger>): ProjectionYear {
  return {
    year: 2031,
    ages: { client: 64, spouse: 62 },
    accountLedgers,
  } as unknown as ProjectionYear;
}

const ctx: AssetLedgerContext = {
  accountNames: { brokerage: "Joint Brokerage", ira: "John IRA", trustAcct: "Trust Brokerage" },
  accountCategories: { brokerage: "taxable", ira: "retirement", trustAcct: "taxable" },
  entityNames: { ent1: "Smith Family Trust" },
  entityKinds: { ent1: "trust" },
  accountEntityOwners: new Map([["trustAcct", { entityId: "ent1", percent: 1 }]]),
};

describe("buildAssetLedger", () => {
  const year = mkYear({
    brokerage: mkLedger({
      beginningValue: 500_000,
      growth: 32_000,
      contributions: 12_000,
      endingValue: 537_000,
      entries: [
        { category: "growth", label: "Growth", amount: 32_000, basis: 32_000 },
        { category: "savings_contribution", label: "Savings", amount: 12_000, basis: 12_000 },
        { category: "withdrawal", label: "Supplemental withdrawal", amount: -7_000, basis: -7_000, isInternalTransfer: true },
      ],
    }),
    ira: mkLedger({
      beginningValue: 300_000,
      growth: 21_000,
      rmdAmount: 14_000,
      endingValue: 307_000,
      entries: [
        { category: "growth", label: "Growth", amount: 21_000, basis: 0 },
        { category: "rmd", label: "RMD", amount: -14_000, basis: 0 },
      ],
    }),
    trustAcct: mkLedger({
      beginningValue: 100_000,
      growth: 5_000,
      endingValue: 105_000,
      entries: [{ category: "growth", label: "Growth", amount: 5_000, basis: 5_000 }],
    }),
  });

  it("groups household accounts under Household and entity accounts under the entity", () => {
    const ledger = buildAssetLedger(year, ctx);
    expect(ledger.sections.map((s) => s.label)).toEqual(["Household", "Smith Family Trust"]);
    expect(ledger.sections[0].kind).toBe("household");
    expect(ledger.sections[0].accounts.map((a) => a.name)).toEqual(["John IRA", "Joint Brokerage"]); // retirement < taxable by category
    expect(ledger.sections[1].kind).toBe("trust");
    expect(ledger.sections[1].accounts.map((a) => a.name)).toEqual(["Trust Brokerage"]);
  });

  it("maps entries to signed rows, plumbs the internal-transfer flag", () => {
    const ledger = buildAssetLedger(year, ctx);
    const brokerage = ledger.sections[0].accounts.find((a) => a.name === "Joint Brokerage")!;
    // 3 entry rows + 2 bookend rows (BoY + EoY) = 5
    expect(brokerage.rows).toHaveLength(5);
    const wd = brokerage.rows.find((r) => r.category === "withdrawal")!;
    expect(wd.amount).toBe(-7_000);
    expect(wd.internal).toBe(true);
    expect(brokerage.rows.find((r) => r.category === "growth" && !r.bookend)!.internal).toBe(false);
  });

  it("surfaces summary figures and net change", () => {
    const ledger = buildAssetLedger(year, ctx);
    const ira = ledger.sections[0].accounts.find((a) => a.name === "John IRA")!;
    expect(ira.summary.growth).toBe(21_000);
    expect(ira.summary.rmd).toBe(14_000);
    expect(ira.netChange).toBe(7_000);
  });

  it("reconciles when entries sum to ending − beginning", () => {
    const ledger = buildAssetLedger(year, ctx);
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
        entries: [{ category: "growth", label: "Growth", amount: 5_000, basis: 5_000 }], // ...but entries only +5k
      }),
    });
    const ledger = buildAssetLedger(broken, ctx);
    const block = ledger.sections[0].accounts[0];
    expect(block.reconciles).toBe(false);
    expect(block.residual).toBe(15_000);
  });

  it("skips fully-empty accounts (no balance, no entries)", () => {
    const withEmpty = mkYear({
      brokerage: mkLedger({ beginningValue: 0, endingValue: 0, entries: [] }),
      ira: mkLedger({ beginningValue: 1, endingValue: 1, entries: [{ category: "growth", label: "Growth", amount: 0 }] }),
    });
    const ledger = buildAssetLedger(withEmpty, ctx);
    const names = ledger.sections.flatMap((s) => s.accounts.map((a) => a.name));
    expect(names).toEqual(["John IRA"]);
  });

  it("labels an unknown-entity owner with its raw id rather than dropping it", () => {
    const orphanCtx: AssetLedgerContext = {
      ...ctx,
      entityNames: {}, // entity not in the map
      entityKinds: {},
      accountEntityOwners: new Map([["brokerage", { entityId: "ghost", percent: 1 }]]),
    };
    const y = mkYear({ brokerage: mkLedger({ beginningValue: 10, endingValue: 10, entries: [{ category: "growth", label: "Growth", amount: 0 }] }) });
    const ledger = buildAssetLedger(y, orphanCtx);
    expect(ledger.sections.map((s) => s.label)).toEqual(["ghost"]);
    expect(ledger.sections[0].kind).toBe("business"); // default kind
  });

  // ── New tests for Task 5 ────────────────────────────────────────────────────

  it("synthesizes Beginning/End of Year bookend rows with amount and basis", () => {
    const ledger = buildAssetLedger(mkYear({
      brokerage: mkLedger({
        beginningValue: 500_000, basisBoY: 400_000,
        endingValue: 532_000, basisEoY: 432_000,
        entries: [{ category: "growth", label: "Growth", amount: 32_000, basis: 32_000 }],
      }),
    }), ctx);
    const acct = ledger.sections[0].accounts[0];
    const boy = acct.rows.find((r) => r.label === "Beginning of Year")!;
    const eoy = acct.rows.find((r) => r.label === "End of Year")!;
    expect(boy.bookend).toBe(true);
    expect(boy.amount).toBe(500_000);
    expect(boy.basis).toBe(400_000);
    expect(eoy.bookend).toBe(true);
    expect(eoy.amount).toBe(532_000);
    expect(eoy.basis).toBe(432_000);
  });

  it("resolves counterpartyName from the account/entity name maps", () => {
    const ledger = buildAssetLedger(mkYear({
      brokerage: mkLedger({
        beginningValue: 10, endingValue: 10,
        entries: [{
          category: "savings_contribution", label: "Contribution to IRA",
          amount: -5, basis: -5, counterpartyId: "ira",
        }],
      }),
    }), ctx);
    const row = ledger.sections[0].accounts[0].rows.find((r) => r.label.startsWith("Contribution"))!;
    expect(row.counterpartyName).toBe("John IRA"); // ctx.accountNames["ira"]
  });

  it("resolves counterpartyName from entityNames when not in accountNames", () => {
    const ledger = buildAssetLedger(mkYear({
      brokerage: mkLedger({
        beginningValue: 10, endingValue: 10,
        entries: [{
          category: "entity_distribution", label: "Distribution from Trust",
          amount: 5, basis: 5, counterpartyId: "ent1",
        }],
      }),
    }), ctx);
    const row = ledger.sections[0].accounts[0].rows.find((r) => r.label.startsWith("Distribution"))!;
    expect(row.counterpartyName).toBe("Smith Family Trust"); // ctx.entityNames["ent1"]
  });

  it("carries per-row basis (0 when entry.basis is undefined)", () => {
    const ledger = buildAssetLedger(mkYear({
      brokerage: mkLedger({
        beginningValue: 10, endingValue: 15,
        entries: [
          { category: "growth", label: "Growth", amount: 5, basis: 3 },
          { category: "income", label: "Dividend", amount: 0 }, // no basis field
        ],
      }),
    }), ctx);
    const rows = ledger.sections[0].accounts[0].rows.filter((r) => !r.bookend);
    expect(rows.find((r) => r.label === "Growth")!.basis).toBe(3);
    expect(rows.find((r) => r.label === "Dividend")!.basis).toBe(0);
  });

  it("computes basisResidual as basisEoY − basisBoY − Σ(non-bookend row.basis)", () => {
    const ledger = buildAssetLedger(mkYear({
      brokerage: mkLedger({
        beginningValue: 500_000, basisBoY: 400_000,
        endingValue: 532_000, basisEoY: 432_000,
        entries: [{ category: "growth", label: "Growth", amount: 32_000, basis: 32_000 }],
      }),
    }), ctx);
    const acct = ledger.sections[0].accounts[0];
    // basisEoY (432000) - basisBoY (400000) - entry.basis (32000) = 0
    expect(acct.basisResidual).toBe(0);
    expect(acct.basisBoY).toBe(400_000);
    expect(acct.basisEoY).toBe(432_000);
  });

  it("adds Roth bookend rows when the account tracks a Roth sub-balance", () => {
    const ledger = buildAssetLedger(mkYear({
      ira: mkLedger({
        beginningValue: 100, endingValue: 100,
        basisBoY: 0, basisEoY: 0,
        rothValueBoY: 40, rothValueEoY: 45,
        entries: [],
      }),
    }), ctx);
    const acct = ledger.sections[0].accounts[0];
    expect(acct.rothValueBoY).toBe(40);
    expect(acct.rothValueEoY).toBe(45);
    expect(acct.rows.find((r) => r.label === "Beginning of Year - Roth")?.amount).toBe(40);
    expect(acct.rows.find((r) => r.label === "End of Year - Roth")?.amount).toBe(45);
    expect(acct.rows.find((r) => r.label === "Beginning of Year - Roth")?.bookend).toBe(true);
    expect(acct.rows.find((r) => r.label === "End of Year - Roth")?.bookend).toBe(true);
  });

  it("does not add Roth bookend rows when rothValueBoY is absent", () => {
    const ledger = buildAssetLedger(mkYear({
      brokerage: mkLedger({
        beginningValue: 10, endingValue: 10,
        entries: [],
      }),
    }), ctx);
    const acct = ledger.sections[0].accounts[0];
    expect(acct.rows.find((r) => r.label === "Beginning of Year - Roth")).toBeUndefined();
    expect(acct.rows.find((r) => r.label === "End of Year - Roth")).toBeUndefined();
  });

  it("reconciles still uses amount residual only (not basis)", () => {
    // entries sum correctly by amount but not by basis — reconciles should still be true
    const ledger = buildAssetLedger(mkYear({
      brokerage: mkLedger({
        beginningValue: 100_000, endingValue: 105_000,
        basisBoY: 80_000, basisEoY: 90_000,
        entries: [{ category: "growth", label: "Growth", amount: 5_000, basis: 5_000 }],
        // basisResidual = 90000 - 80000 - 5000 = 5000 (nonzero) but reconciles on amount
      }),
    }), ctx);
    const acct = ledger.sections[0].accounts[0];
    expect(acct.reconciles).toBe(true);
    expect(acct.residual).toBe(0);
    expect(acct.basisResidual).toBe(5_000); // informational only
  });
});
