import { describe, it, expect } from "vitest";
import { expenseCreateSchema } from "../expenses";

describe("expenseCreateSchema education", () => {
  it("parses education fields + dedicated account ids", () => {
    const r = expenseCreateSchema.safeParse({
      type: "education", name: "College", annualAmount: "20000",
      startYear: 2033, endYear: 2036,
      payShortfallOutOfPocket: true, institutionState: "PA",
      institutionName: "Penn State",
      forFamilyMemberId: "00000000-0000-0000-0000-000000000001",
      dedicatedAccountIds: ["00000000-0000-0000-0000-000000000002"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.payShortfallOutOfPocket).toBe(true);
      expect(r.data.dedicatedAccountIds).toHaveLength(1);
    }
  });

  it("defaults payShortfallOutOfPocket to false and dedicatedAccountIds to []", () => {
    const r = expenseCreateSchema.safeParse({ type: "education", name: "C", startYear: 2033, endYear: 2036 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.payShortfallOutOfPocket).toBe(false);
      expect(r.data.dedicatedAccountIds).toEqual([]);
    }
  });
});
