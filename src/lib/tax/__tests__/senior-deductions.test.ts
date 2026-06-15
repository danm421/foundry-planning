import { describe, it, expect } from "vitest";
import { getAdditionalStdDeduction, getObbbaSeniorBonus } from "../senior-deductions";

describe("getAdditionalStdDeduction (§63(f))", () => {
  it("MFJ both 65+ → 2×$1,650 = $3,300 at factor 1.0", () => {
    expect(getAdditionalStdDeduction(2026, "married_joint", 70, 70, 1.0)).toBe(3300);
  });
  it("MFJ one 65+ → $1,650", () => {
    expect(getAdditionalStdDeduction(2026, "married_joint", 70, 60, 1.0)).toBe(1650);
  });
  it("single 65+ → $2,050", () => {
    expect(getAdditionalStdDeduction(2026, "single", 67, undefined, 1.0)).toBe(2050);
  });
  it("HOH 65+ → unmarried $2,050 (one box)", () => {
    expect(getAdditionalStdDeduction(2026, "head_of_household", 67, undefined, 1.0)).toBe(2050);
  });
  it("MFS 65+ → married per-box $1,650, one box (spouse never counts for MFS)", () => {
    expect(getAdditionalStdDeduction(2026, "married_separate", 67, undefined, 1.0)).toBe(1650);
  });
  it("under 65 → 0", () => {
    expect(getAdditionalStdDeduction(2026, "single", 60, undefined, 1.0)).toBe(0);
  });
  it("inflates by factor, floored to $50", () => {
    expect(getAdditionalStdDeduction(2030, "single", 67, undefined, 1.10)).toBe(2250); // 2050*1.1=2255 → floor 50
  });
});

describe("getObbbaSeniorBonus (OBBBA 2025-2028)", () => {
  it("MFJ both 65+, MAGI below threshold → $12,000", () => {
    expect(getObbbaSeniorBonus(2026, "married_joint", 70, 70, 100_000)).toBe(12000);
  });
  it("MFJ both 65+ fully phased out at $250k MAGI → 0", () => {
    expect(getObbbaSeniorBonus(2026, "married_joint", 70, 70, 250_000)).toBe(0);
  });
  it("MFJ both 65+ partial phaseout at $200k → 6000 (per-senior phaseout)", () => {
    // Statute (§70103): each $6,000 is phased out separately. At $200k MAGI each
    // senior's $6,000 is reduced by 0.06×(200k-150k)=3000 → 3000 each → 6000 total.
    // (NOT 12000-3000=9000, which would apply the phaseout once to the combined base.)
    expect(getObbbaSeniorBonus(2026, "married_joint", 70, 70, 200_000)).toBe(6000);
  });
  it("single 65+ fully phased out at $175k → 0", () => {
    expect(getObbbaSeniorBonus(2026, "single", 67, undefined, 175_000)).toBe(0);
  });
  it("MFS 65+ uses single $75k threshold → 6000 - 0.06×(100k-75k) = 4500", () => {
    // `married` is strictly married_joint, so MFS gets the single threshold.
    expect(getObbbaSeniorBonus(2026, "married_separate", 67, undefined, 100_000)).toBe(4500);
  });
  it("HOH 65+ uses single $75k threshold → 4500", () => {
    expect(getObbbaSeniorBonus(2026, "head_of_household", 67, undefined, 100_000)).toBe(4500);
  });
  it("year 2029 → 0 (sunset)", () => {
    expect(getObbbaSeniorBonus(2029, "married_joint", 70, 70, 100_000)).toBe(0);
  });
});
