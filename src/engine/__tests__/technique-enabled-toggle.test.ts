import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings } from "./fixtures";
import type {
  AssetTransaction,
  Reinvestment,
  RothConversion,
  ProjectionYear,
} from "../types";

const SETTINGS = { ...basePlanSettings, planStartYear: 2026, planEndYear: 2032 };
const yearOf = (rows: ProjectionYear[], year: number) =>
  rows.find((r) => r.year === year)!;

describe("technique enabled toggle — disabled behaves identically to absent", () => {
  it("reinvestment: enabled !== false is honored; enabled === false is skipped", () => {
    const ri: Reinvestment = {
      id: "ri-1",
      name: "Shift to conservative",
      accountIds: ["acct-brokerage"],
      year: 2030,
      newGrowthRate: 0.04,
      newRealization: {
        pctOrdinaryIncome: 0,
        pctLtCapitalGains: 0,
        pctQualifiedDividends: 0,
        pctTaxExempt: 0,
        turnoverPct: 0,
      },
      realizeTaxesOnSwitch: true,
      soldFractionByAccount: { "acct-brokerage": 0.5 },
    };
    const absent = runProjection(buildClientData({ planSettings: SETTINGS }));
    const enabled = runProjection(
      buildClientData({ reinvestments: [ri], planSettings: SETTINGS }),
    );
    const disabled = runProjection(
      buildClientData({
        reinvestments: [{ ...ri, enabled: false }],
        planSettings: SETTINGS,
      }),
    );

    // Disabled == absent for the switch year's realized gains.
    expect(yearOf(disabled, 2030).taxDetail!.capitalGains).toBe(
      yearOf(absent, 2030).taxDetail!.capitalGains,
    );
    // Enabled actually changes the outcome (guards against a no-op fixture).
    expect(yearOf(enabled, 2030).taxDetail!.capitalGains).not.toBe(
      yearOf(absent, 2030).taxDetail!.capitalGains,
    );
  });

  it("asset transaction: a disabled sale realizes nothing", () => {
    const sale: AssetTransaction = {
      id: "sell-1",
      name: "Sell brokerage",
      type: "sell",
      year: 2030,
      accountId: "acct-brokerage",
      proceedsAccountId: "acct-savings",
    };
    const absent = runProjection(buildClientData({ planSettings: SETTINGS }));
    const enabled = runProjection(
      buildClientData({ assetTransactions: [sale], planSettings: SETTINGS }),
    );
    const disabled = runProjection(
      buildClientData({
        assetTransactions: [{ ...sale, enabled: false }],
        planSettings: SETTINGS,
      }),
    );

    expect(yearOf(disabled, 2030).taxDetail!.capitalGains).toBe(
      yearOf(absent, 2030).taxDetail!.capitalGains,
    );
    expect(yearOf(enabled, 2030).taxDetail!.capitalGains).not.toBe(
      yearOf(absent, 2030).taxDetail!.capitalGains,
    );
  });

  it("roth conversion: a disabled conversion recognizes no ordinary income", () => {
    const rc: RothConversion = {
      id: "rc-1",
      name: "Convert $25k",
      destinationAccountId: "acct-roth",
      sourceAccountIds: ["acct-401k"],
      conversionType: "fixed_amount",
      fixedAmount: 25000,
      startYear: 2030,
      endYear: 2030,
      indexingRate: 0,
    };
    const absent = runProjection(buildClientData({ planSettings: SETTINGS }));
    const enabled = runProjection(
      buildClientData({ rothConversions: [rc], planSettings: SETTINGS }),
    );
    const disabled = runProjection(
      buildClientData({
        rothConversions: [{ ...rc, enabled: false }],
        planSettings: SETTINGS,
      }),
    );

    expect(yearOf(disabled, 2030).taxDetail!.ordinaryIncome).toBe(
      yearOf(absent, 2030).taxDetail!.ordinaryIncome,
    );
    expect(yearOf(enabled, 2030).taxDetail!.ordinaryIncome).not.toBe(
      yearOf(absent, 2030).taxDetail!.ordinaryIncome,
    );
  });
});
