import { describe, it, expect } from "vitest";
import {
  giftPercentToWhole,
  roundGiftPercent,
  wholeToGiftPercent,
} from "@/lib/gifts/gift-percent";

describe("gift-percent", () => {
  it("rounds a share to the 4dp the column stores", () => {
    // 0.01% is the finest slice `decimal(6, 4)` can hold; anything past it is
    // a number the preview could show but the save would silently change.
    expect(roundGiftPercent(0.123456)).toBe(0.1235);
    expect(roundGiftPercent(0.00004)).toBe(0);
  });

  it("clamps outside 0–100% rather than storing an impossible share", () => {
    expect(roundGiftPercent(1.5)).toBe(1);
    expect(roundGiftPercent(-0.2)).toBe(0);
  });

  it("treats a broken input as no share, not as the whole asset", () => {
    // A non-finite value means the field is mid-edit or divided by a $0
    // balance. Falling to 0 leaves the draft invalid and Save disabled;
    // clamping to 1 would quietly gift the entire asset instead.
    expect(roundGiftPercent(Number.NaN)).toBe(0);
    expect(roundGiftPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("round-trips a fractional percent through the form's display units", () => {
    // The bug this guards: a whole-number round trip turned a saved 4.25% into
    // 4% on the next save.
    expect(giftPercentToWhole(0.0425)).toBe(4.25);
    expect(wholeToGiftPercent(4.25)).toBe(0.0425);
    expect(wholeToGiftPercent(giftPercentToWhole(0.0425))).toBe(0.0425);
  });

  it("converts whole percent to the stored fraction, not to itself", () => {
    // Guards the x100 scale error: 25 must become 0.25, never 25 or 0.0025.
    expect(wholeToGiftPercent(25)).toBe(0.25);
    expect(wholeToGiftPercent(100)).toBe(1);
  });
});
