import { describe, it, expect } from "vitest";
import type { ClientMilestones } from "@/lib/milestones";
import {
  LIVING_CURRENT_NAME,
  LIVING_RETIREMENT_NAME,
  LIVING_EDITABLE_FIELDS,
  livingSlotRole,
  isCurrentLivingHidden,
} from "../living-expenses";

const milestones = (clientRetirement: number): ClientMilestones => ({
  planStart: 2026,
  planEnd: 2060,
  clientRetirement,
  clientEnd: 2060,
  clientSS62: 2030,
  clientSSFRA: 2035,
  clientSS70: 2038,
});

describe("livingSlotRole", () => {
  it("classifies plan_start as current", () => {
    expect(livingSlotRole("plan_start")).toBe("current");
  });

  it("classifies both retirement anchors as retirement", () => {
    expect(livingSlotRole("client_retirement")).toBe("retirement");
    expect(livingSlotRole("spouse_retirement")).toBe("retirement");
  });

  it("returns null for an unclassifiable or absent ref", () => {
    expect(livingSlotRole("plan_end")).toBeNull();
    expect(livingSlotRole("client_ss_62")).toBeNull();
    expect(livingSlotRole(null)).toBeNull();
  });
});

describe("isCurrentLivingHidden", () => {
  it("hides Current once the client's retirement is at or before plan start", () => {
    expect(isCurrentLivingHidden(milestones(2020), 2026)).toBe(true);
    expect(isCurrentLivingHidden(milestones(2026), 2026)).toBe(true);
  });

  it("keeps Current visible while the client is still working", () => {
    expect(isCurrentLivingHidden(milestones(2040), 2026)).toBe(false);
  });
});

describe("LIVING_EDITABLE_FIELDS", () => {
  it("permits exactly amount and timing", () => {
    expect([...LIVING_EDITABLE_FIELDS].sort()).toEqual([
      "annualAmount",
      "endYear",
      "endYearRef",
      "startYear",
      "startYearRef",
    ]);
  });

  it("excludes every field the two-bucket model locks", () => {
    for (const locked of [
      "name", "growthRate", "growthSource", "cashAccountId", "ownerEntityId",
      "ownerAccountId", "deductionType", "inflationStartYear", "isGoal",
      "endsAtMedicareEligibilityOwner",
    ]) {
      expect(LIVING_EDITABLE_FIELDS.has(locked)).toBe(false);
    }
  });
});

describe("canonical names", () => {
  it("matches what the client seeder writes", () => {
    expect(LIVING_CURRENT_NAME).toBe("Current Living Expenses");
    expect(LIVING_RETIREMENT_NAME).toBe("Retirement Living Expenses");
  });
});
