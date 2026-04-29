import { describe, it, expect } from "vitest";
import {
  buildClientMilestones,
  resolveMilestone,
  availableRefs,
  defaultIncomeRefs,
  defaultExpenseRefs,
  defaultSavingsRuleRefs,
  defaultWithdrawalRefs,
} from "../milestones";

const CLIENT = {
  dateOfBirth: "1965-06-15",
  retirementAge: 62,
  planEndAge: 95,
  spouseDob: "1968-03-10",
  spouseRetirementAge: 65,
};

describe("buildClientMilestones", () => {
  it("computes all milestones from client data", () => {
    const m = buildClientMilestones(CLIENT, 2026, 2060);
    expect(m.planStart).toBe(2026);
    expect(m.planEnd).toBe(2060);
    expect(m.clientRetirement).toBe(2027); // 1965 + 62
    expect(m.clientEnd).toBe(2060); // 1965 + 95
    expect(m.spouseRetirement).toBe(2033); // 1968 + 65
    expect(m.spouseEnd).toBe(2063); // 1968 + 95
    expect(m.clientSS62).toBe(2027); // 1965 + 62
    expect(m.clientSSFRA).toBe(2032); // 1965 + 67
    expect(m.clientSS70).toBe(2035); // 1965 + 70
    expect(m.spouseSS62).toBe(2030); // 1968 + 62
  });

  it("handles no spouse", () => {
    const m = buildClientMilestones(
      { dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 90 },
      2026,
      2060
    );
    expect(m.spouseRetirement).toBeUndefined();
    expect(m.spouseEnd).toBeUndefined();
    expect(m.spouseSS62).toBeUndefined();
  });
});

describe("resolveMilestone", () => {
  const m = buildClientMilestones(CLIENT, 2026, 2060);

  it("resolves each ref type", () => {
    expect(resolveMilestone("plan_start", m)).toBe(2026);
    expect(resolveMilestone("client_retirement", m)).toBe(2027);
    expect(resolveMilestone("spouse_end", m)).toBe(2063);
    expect(resolveMilestone("client_ss_fra", m)).toBe(2032);
  });

  it("returns undefined for missing spouse refs", () => {
    const noSpouse = buildClientMilestones(
      { dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 90 },
      2026, 2060
    );
    expect(resolveMilestone("spouse_retirement", noSpouse)).toBeUndefined();
  });

  describe("position-aware resolution", () => {
    it("transition refs return year - 1 when used as end position (last year of prior state)", () => {
      // Retirement year is 2027 — first retired year. As an endYear,
      // the salary's last working year is 2026 (year before retirement).
      expect(resolveMilestone("client_retirement", m, "end")).toBe(2026);
      expect(resolveMilestone("spouse_retirement", m, "end")).toBe(2032);
      expect(resolveMilestone("client_end", m, "end")).toBe(2059);
      expect(resolveMilestone("spouse_end", m, "end")).toBe(2062);
      expect(resolveMilestone("client_ss_fra", m, "end")).toBe(2031);
    });

    it("transition refs return the milestone year when used as start position", () => {
      expect(resolveMilestone("client_retirement", m, "start")).toBe(2027);
      expect(resolveMilestone("spouse_end", m, "start")).toBe(2063);
      expect(resolveMilestone("client_ss_fra", m, "start")).toBe(2032);
    });

    it("plan_start and plan_end are absolute bounds (not transitions) — no offset for end position", () => {
      expect(resolveMilestone("plan_start", m, "end")).toBe(2026);
      expect(resolveMilestone("plan_end", m, "end")).toBe(2060);
    });

    it("default position is 'start' (preserves prior behavior)", () => {
      expect(resolveMilestone("client_retirement", m)).toBe(
        resolveMilestone("client_retirement", m, "start")
      );
    });

    it("returns undefined for missing spouse refs regardless of position", () => {
      const noSpouse = buildClientMilestones(
        { dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 90 },
        2026, 2060
      );
      expect(resolveMilestone("spouse_retirement", noSpouse, "end")).toBeUndefined();
    });
  });
});

describe("availableRefs", () => {
  it("includes spouse refs when spouse exists", () => {
    const m = buildClientMilestones(CLIENT, 2026, 2060);
    const refs = availableRefs(m);
    expect(refs.some((r) => r.ref === "spouse_retirement")).toBe(true);
  });

  it("excludes spouse refs when no spouse", () => {
    const m = buildClientMilestones(
      { dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 90 },
      2026, 2060
    );
    const refs = availableRefs(m);
    expect(refs.some((r) => r.ref === "spouse_retirement")).toBe(false);
  });

  it("includes SS refs when requested", () => {
    const m = buildClientMilestones(CLIENT, 2026, 2060);
    const refs = availableRefs(m, true);
    expect(refs.some((r) => r.ref === "client_ss_62")).toBe(true);
    expect(refs.some((r) => r.ref === "spouse_ss_fra")).toBe(true);
  });

  it("displays end-position years for transition refs (year - 1)", () => {
    const m = buildClientMilestones(CLIENT, 2026, 2060);
    const refs = availableRefs(m, false, "end");
    const retirement = refs.find((r) => r.ref === "client_retirement");
    expect(retirement?.year).toBe(2026); // 2027 - 1
    const planEnd = refs.find((r) => r.ref === "plan_end");
    expect(planEnd?.year).toBe(2060); // absolute bound, no offset
  });
});

describe("smart defaults", () => {
  it("salary defaults to plan_start → client_retirement", () => {
    const d = defaultIncomeRefs("salary", "client");
    expect(d.startYearRef).toBe("plan_start");
    expect(d.endYearRef).toBe("client_retirement");
  });

  it("salary for spouse uses spouse_retirement", () => {
    const d = defaultIncomeRefs("salary", "spouse");
    expect(d.endYearRef).toBe("spouse_retirement");
  });

  it("social_security has null startYearRef (uses claimingAge)", () => {
    const d = defaultIncomeRefs("social_security", "client");
    expect(d.startYearRef).toBeNull();
    expect(d.endYearRef).toBe("client_end");
  });

  it("deferred starts at retirement", () => {
    const d = defaultIncomeRefs("deferred", "client");
    expect(d.startYearRef).toBe("client_retirement");
    expect(d.endYearRef).toBe("client_end");
  });

  it("expenses default to plan_start → plan_end", () => {
    const d = defaultExpenseRefs("living");
    expect(d.startYearRef).toBe("plan_start");
    expect(d.endYearRef).toBe("plan_end");
  });

  it("savings rules default to plan_start → client_retirement", () => {
    const d = defaultSavingsRuleRefs();
    expect(d.startYearRef).toBe("plan_start");
    expect(d.endYearRef).toBe("client_retirement");
  });

  it("withdrawal defaults to client_retirement → plan_end", () => {
    const d = defaultWithdrawalRefs();
    expect(d.startYearRef).toBe("client_retirement");
    expect(d.endYearRef).toBe("plan_end");
  });
});
