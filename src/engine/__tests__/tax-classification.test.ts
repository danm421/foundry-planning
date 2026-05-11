import { describe, it, expect } from "vitest";
import { classifyTransferTax } from "../tax-classification";

describe("classifyTransferTax", () => {
  const baseArgs = {
    sourceCategory: "retirement" as const,
    sourceSubType: "traditional_ira",
    targetCategory: "retirement" as const,
    targetSubType: "traditional_ira",
    amount: 50000,
    sourceAccountValue: 200000,
    sourceAccountBasis: 0,
    allTraditionalIraBasis: 0,
    allTraditionalIraBalance: 200000,
    ownerAge: 65,
    rothBasis: 0,
  };

  it("tax-free for IRA → IRA rollover", () => {
    const result = classifyTransferTax(baseArgs);
    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.capitalGain).toBe(0);
    expect(result.earlyWithdrawalPenalty).toBe(0);
    expect(result.label).toBe("tax_free_rollover");
  });

  it("tax-free for 401k → IRA rollover", () => {
    const result = classifyTransferTax({ ...baseArgs, sourceSubType: "401k" });
    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.label).toBe("tax_free_rollover");
  });

  it("taxable as ordinary income for IRA → Roth IRA conversion", () => {
    const result = classifyTransferTax({ ...baseArgs, targetSubType: "roth_ira" });
    expect(result.taxableOrdinaryIncome).toBe(50000);
    expect(result.label).toBe("roth_conversion");
  });

  it("applies pro-rata rule when traditional IRA has basis", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      targetSubType: "roth_ira",
      allTraditionalIraBasis: 40000,
      allTraditionalIraBalance: 200000,
    });
    // 20% is basis → 80% taxable
    expect(result.taxableOrdinaryIncome).toBe(40000);
    expect(result.label).toBe("roth_conversion");
  });

  it("tax-free for Roth → Roth transfer", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "roth_ira",
      targetSubType: "roth_ira",
    });
    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.label).toBe("tax_free_rollover");
  });

  it("fully Roth 401k (rothValue == value) → Roth IRA: no taxable income", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "401k",
      targetSubType: "roth_ira",
      sourceAccountValue: 200000,
      sourceRothValue: 200000,
    });
    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.label).toBe("roth_conversion");
  });

  it("partial Roth 401k → Roth IRA: pro-rata Roth slice tax-free", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "401k",
      targetSubType: "roth_ira",
      amount: 50000,
      sourceAccountValue: 200000,
      sourceRothValue: 50000, // 25% of balance is Roth
    });
    // 25% of slice tax-free → 75% taxable
    expect(result.taxableOrdinaryIncome).toBe(37500);
    expect(result.label).toBe("roth_conversion");
  });

  it("pre-tax 401k → Roth IRA: full conversion taxable, ignores any leftover basis", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "401k",
      targetSubType: "roth_ira",
      // Stale basis must NOT bleed into the conversion calc — that was the bug.
      sourceAccountBasis: 30000,
      sourceAccountValue: 200000,
      sourceRothValue: 0,
    });
    expect(result.taxableOrdinaryIncome).toBe(50000);
    expect(result.label).toBe("roth_conversion");
  });

  it("no tax for taxable → taxable transfer (no appreciation)", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceCategory: "taxable",
      sourceSubType: "brokerage",
      targetCategory: "taxable",
      targetSubType: "brokerage",
      sourceAccountValue: 200000,
      sourceAccountBasis: 200000,
    });
    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.capitalGain).toBe(0);
    expect(result.label).toBe("taxable_liquidation");
  });

  it("triggers capital gains when liquidating appreciated taxable account", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceCategory: "taxable",
      sourceSubType: "brokerage",
      targetCategory: "cash",
      targetSubType: "checking",
      sourceAccountValue: 200000,
      sourceAccountBasis: 100000,
    });
    // 50k out of 200k → proportional gain = 50000/200000 * (200000-100000) = 25000
    expect(result.capitalGain).toBe(25000);
    expect(result.label).toBe("taxable_liquidation");
  });

  it("10% penalty for retirement → cash before 59.5", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "traditional_ira",
      targetCategory: "cash",
      targetSubType: "checking",
      ownerAge: 55,
    });
    expect(result.taxableOrdinaryIncome).toBe(50000);
    expect(result.earlyWithdrawalPenalty).toBe(5000);
    expect(result.label).toBe("early_distribution");
  });

  it("no penalty for retirement → cash at 60", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "traditional_ira",
      targetCategory: "cash",
      targetSubType: "checking",
      ownerAge: 60,
    });
    expect(result.taxableOrdinaryIncome).toBe(50000);
    expect(result.earlyWithdrawalPenalty).toBe(0);
    expect(result.label).toBe("taxable_distribution");
  });

  it("Roth → cash: penalty only on earnings above basis before 59.5", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "roth_ira",
      targetCategory: "cash",
      targetSubType: "checking",
      ownerAge: 55,
      rothBasis: 30000,
      sourceAccountValue: 80000,
      amount: 50000,
    });
    // First 30k is basis (tax-free, penalty-free), remaining 20k is earnings
    expect(result.taxableOrdinaryIncome).toBe(20000);
    expect(result.earlyWithdrawalPenalty).toBe(2000); // 10% of 20k earnings
  });

  it("Roth → cash: no penalty when withdrawal is within basis", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "roth_ira",
      targetCategory: "cash",
      targetSubType: "checking",
      ownerAge: 55,
      rothBasis: 60000,
      sourceAccountValue: 80000,
      amount: 50000,
    });
    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.earlyWithdrawalPenalty).toBe(0);
  });

  it("no penalty for Roth conversion (IRA → Roth) regardless of age", () => {
    const result = classifyTransferTax({
      ...baseArgs,
      sourceSubType: "traditional_ira",
      targetSubType: "roth_ira",
      ownerAge: 45,
    });
    expect(result.taxableOrdinaryIncome).toBe(50000);
    expect(result.earlyWithdrawalPenalty).toBe(0);
    expect(result.label).toBe("roth_conversion");
  });
});

describe("classifyTransferTax taxable source — fresh-basis-first (spec 2026-05-11)", () => {
  const base = {
    sourceCategory: "taxable" as const,
    sourceSubType: "brokerage",
    targetCategory: "cash" as const,
    targetSubType: "checking",
    allTraditionalIraBasis: 0,
    allTraditionalIraBalance: 0,
    ownerAge: 50,
    rothBasis: 0,
  };

  it("back-compat: sourceFreshBasis=0 (or undefined) matches pro-rata", () => {
    const r = classifyTransferTax({
      ...base, amount: 100, sourceAccountValue: 1000, sourceAccountBasis: 400,
    });
    expect(r.capitalGain).toBeCloseTo(60, 2);
    expect(r.basisReturn).toBeCloseTo(40, 2);
  });

  it("fully covered by fresh: 0 cap gain, full basisReturn", () => {
    const r = classifyTransferTax({
      ...base, amount: 50, sourceAccountValue: 1000, sourceAccountBasis: 400,
      sourceFreshBasis: 100,
    });
    expect(r.capitalGain).toBe(0);
    expect(r.basisReturn).toBe(50);
  });

  it("straddles fresh + legacy: legacy ratio used for overflow", () => {
    // legacy: value 900, basis 300 → gain ratio 0.6667
    // amount 250 → fresh 100 + legacy 150 × 0.6667 = 100 gain
    const r = classifyTransferTax({
      ...base, amount: 250, sourceAccountValue: 1000, sourceAccountBasis: 400,
      sourceFreshBasis: 100,
    });
    expect(r.capitalGain).toBeCloseTo(100, 2);
    expect(r.basisReturn).toBeCloseTo(150, 2);
  });
});
