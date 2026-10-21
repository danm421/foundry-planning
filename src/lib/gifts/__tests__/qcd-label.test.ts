import { describe, it, expect } from "vitest";
import { qcdGiftLabel } from "../qcd-label";

describe("qcdGiftLabel", () => {
  it("reads 'Full RMD' for a full-RMD QCD, recurring or not", () => {
    for (const recurring of [true, false]) {
      expect(
        qcdGiftLabel({ accountName: "Jane IRA", amountMode: "full_rmd", amount: 0, recurring }),
      ).toBe("QCD from Jane IRA · Full RMD");
    }
  });

  it("reads '$X/yr' for a recurring fixed QCD", () => {
    expect(
      qcdGiftLabel({ accountName: "Jane IRA", amountMode: "fixed", amount: 25000, recurring: true }),
    ).toBe("QCD from Jane IRA · $25,000/yr");
  });

  it("reads '$X' for a one-time fixed QCD", () => {
    expect(
      qcdGiftLabel({ accountName: "Jane IRA", amountMode: "fixed", amount: 12500, recurring: false }),
    ).toBe("QCD from Jane IRA · $12,500");
  });
});
