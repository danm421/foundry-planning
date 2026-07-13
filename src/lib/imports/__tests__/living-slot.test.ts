import { describe, expect, it } from "vitest";

import {
  livingSlotRole,
  matchLivingSlot,
  type LivingSlot,
} from "../match-keys/living-slot";

const SLOTS: LivingSlot[] = [
  { id: "slot-current", name: "Current Living Expenses", role: "current" },
  { id: "slot-retirement", name: "Retirement Living Expenses", role: "retirement" },
];

describe("livingSlotRole", () => {
  it("maps plan_start to current", () => {
    expect(livingSlotRole("plan_start")).toBe("current");
  });
  it("maps client/spouse retirement to retirement", () => {
    expect(livingSlotRole("client_retirement")).toBe("retirement");
    expect(livingSlotRole("spouse_retirement")).toBe("retirement");
  });
  it("returns null for other refs", () => {
    expect(livingSlotRole("plan_end")).toBeNull();
    expect(livingSlotRole(null)).toBeNull();
  });
});

describe("matchLivingSlot", () => {
  it("links a current living total to the current slot", () => {
    expect(matchLivingSlot({ type: "living", name: "Living Expenses" }, SLOTS)).toEqual({
      kind: "exact",
      existingId: "slot-current",
    });
    expect(matchLivingSlot({ type: "living", name: "Total Monthly Expenses" }, SLOTS)).toEqual({
      kind: "exact",
      existingId: "slot-current",
    });
  });

  it("links a retirement total to the retirement slot (checked before current)", () => {
    expect(
      matchLivingSlot({ type: "living", name: "Retirement Living Expenses" }, SLOTS),
    ).toEqual({ kind: "exact", existingId: "slot-retirement" });
    expect(matchLivingSlot({ type: "living", name: "Retirement Budget" }, SLOTS)).toEqual({
      kind: "exact",
      existingId: "slot-retirement",
    });
  });

  it("returns null for itemized categories", () => {
    expect(matchLivingSlot({ type: "living", name: "Housing" }, SLOTS)).toBeNull();
    expect(matchLivingSlot({ type: "living", name: "Groceries" }, SLOTS)).toBeNull();
  });

  it("returns null for non-living rows", () => {
    expect(matchLivingSlot({ type: "insurance", name: "Living Expenses" }, SLOTS)).toBeNull();
    expect(matchLivingSlot({ name: "Living Expenses" }, SLOTS)).toBeNull();
  });

  it("returns null when the wanted slot is absent", () => {
    const currentOnly: LivingSlot[] = [SLOTS[0]];
    expect(
      matchLivingSlot({ type: "living", name: "Retirement Expenses" }, currentOnly),
    ).toBeNull();
    expect(matchLivingSlot({ type: "living", name: "Living Expenses" }, [])).toBeNull();
  });

  it("returns null for a bare ambiguous 'Retirement' with no qualifier", () => {
    expect(matchLivingSlot({ type: "living", name: "Retirement" }, SLOTS)).toBeNull();
  });
});
