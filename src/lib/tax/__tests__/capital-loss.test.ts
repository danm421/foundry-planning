import { describe, it, expect } from "vitest";
import {
  netCapitalGainsAndLosses,
  computeCarryforwardOut,
  emptyCapitalLossCarryforward,
} from "../capital-loss";

const NONE = emptyCapitalLossCarryforward();

describe("netCapitalGainsAndLosses — §1222 netting", () => {
  it("passes through when both characters are gains", () => {
    const r = netCapitalGainsAndLosses({
      longTermGain: 10_000, shortTermGain: 4_000,
      carryforwardIn: NONE, filingStatus: "single",
    });
    expect(r.netLongTermGain).toBe(10_000);
    expect(r.netShortTermGain).toBe(4_000);
    expect(r.capitalLossDeduction).toBe(0);
  });

  it("cross-nets a short-term loss against long-term gain", () => {
    const r = netCapitalGainsAndLosses({
      longTermGain: 10_000, shortTermGain: -4_000,
      carryforwardIn: NONE, filingStatus: "single",
    });
    expect(r.netLongTermGain).toBe(6_000);
    expect(r.netShortTermGain).toBe(0);
    expect(r.capitalLossDeduction).toBe(0);
  });

  it("cross-nets a long-term loss against short-term gain", () => {
    const r = netCapitalGainsAndLosses({
      longTermGain: -9_000, shortTermGain: 2_000,
      carryforwardIn: NONE, filingStatus: "single",
    });
    expect(r.netShortTermGain).toBe(0);
    expect(r.netLongTermGain).toBe(0);
    expect(r.longTermLoss).toBe(7_000);
    expect(r.capitalLossDeduction).toBe(3_000);
  });

  it("caps the ordinary offset at $3,000", () => {
    const r = netCapitalGainsAndLosses({
      longTermGain: -50_000, shortTermGain: 0,
      carryforwardIn: NONE, filingStatus: "single",
    });
    expect(r.capitalLossDeduction).toBe(3_000);
    expect(r.longTermLoss).toBe(50_000);
  });

  it("caps at $1,500 for married_separate", () => {
    const r = netCapitalGainsAndLosses({
      longTermGain: -50_000, shortTermGain: 0,
      carryforwardIn: NONE, filingStatus: "married_separate",
    });
    expect(r.capitalLossDeduction).toBe(1_500);
  });

  it("seeds prior-year carryforward by character (§1212(b)(1))", () => {
    const r = netCapitalGainsAndLosses({
      longTermGain: 5_000, shortTermGain: 0,
      carryforwardIn: { shortTerm: 0, longTerm: 12_000 },
      filingStatus: "single",
    });
    expect(r.netLongTermGain).toBe(0);
    expect(r.longTermLoss).toBe(7_000);
    expect(r.capitalLossDeduction).toBe(3_000);
  });

  it("keeps both losses when neither character has a gain", () => {
    const r = netCapitalGainsAndLosses({
      longTermGain: -6_000, shortTermGain: -2_000,
      carryforwardIn: NONE, filingStatus: "single",
    });
    expect(r.shortTermLoss).toBe(2_000);
    expect(r.longTermLoss).toBe(6_000);
    expect(r.capitalLossDeduction).toBe(3_000);
  });
});

describe("computeCarryforwardOut — §1212(b)", () => {
  it("absorbs the deduction against SHORT-term loss first", () => {
    const netting = netCapitalGainsAndLosses({
      longTermGain: -5_000, shortTermGain: -2_000,
      carryforwardIn: NONE, filingStatus: "single",
    });
    const { carryforwardOut, carryforwardConsumed } =
      computeCarryforwardOut(netting, 100_000);
    expect(carryforwardConsumed).toBe(3_000);
    expect(carryforwardOut.shortTerm).toBe(0);      // $2,000 fully absorbed
    expect(carryforwardOut.longTerm).toBe(4_000);   // $1,000 of the $5,000 absorbed
  });

  it("consumes NOTHING at zero taxable income but still allows the deduction (§1212(b)(2))", () => {
    const netting = netCapitalGainsAndLosses({
      longTermGain: -50_000, shortTermGain: 0,
      carryforwardIn: NONE, filingStatus: "single",
    });
    const { carryforwardOut, carryforwardConsumed } =
      computeCarryforwardOut(netting, 0);
    expect(netting.capitalLossDeduction).toBe(3_000); // deduction UNAFFECTED
    expect(carryforwardConsumed).toBe(0);
    expect(carryforwardOut.longTerm).toBe(50_000);    // nothing burned
  });

  it("consumes only the usable slice at low taxable income", () => {
    const netting = netCapitalGainsAndLosses({
      longTermGain: -50_000, shortTermGain: 0,
      carryforwardIn: NONE, filingStatus: "single",
    });
    const { carryforwardConsumed, carryforwardOut } =
      computeCarryforwardOut(netting, 1_100);
    expect(carryforwardConsumed).toBe(1_100);
    expect(carryforwardOut.longTerm).toBe(48_900);
  });

  it("clamps negative taxable income to zero", () => {
    const netting = netCapitalGainsAndLosses({
      longTermGain: -20_000, shortTermGain: 0,
      carryforwardIn: NONE, filingStatus: "single",
    });
    const { carryforwardConsumed } = computeCarryforwardOut(netting, -8_000);
    expect(carryforwardConsumed).toBe(0);
  });

  it("returns an empty carryforward when there is no net loss", () => {
    const netting = netCapitalGainsAndLosses({
      longTermGain: 10_000, shortTermGain: 1_000,
      carryforwardIn: NONE, filingStatus: "single",
    });
    const { carryforwardOut } = computeCarryforwardOut(netting, 100_000);
    expect(carryforwardOut).toEqual({ shortTerm: 0, longTerm: 0 });
  });

  it("preserves character across three consecutive years", () => {
    let cf = { shortTerm: 0, longTerm: 30_000 };
    for (let i = 0; i < 3; i++) {
      const n = netCapitalGainsAndLosses({
        longTermGain: 0, shortTermGain: 0,
        carryforwardIn: cf, filingStatus: "single",
      });
      cf = computeCarryforwardOut(n, 100_000).carryforwardOut;
    }
    expect(cf.shortTerm).toBe(0);
    expect(cf.longTerm).toBe(21_000); // 30,000 − 3 × 3,000
  });
});
