import { describe, it, expect } from "vitest";
import { buildQsContext, incomePayload } from "../derive";

const client = {
  dateOfBirth: "1965-04-15",
  retirementAge: 65,
  planEndAge: 95,
  spouseDob: "1967-09-22",
  spouseRetirementAge: 63,
};
const ctx = buildQsContext({
  client,
  planStartYear: 2026,
  planEndYear: 2060,
  clientFirstName: "Alice",
  spouseFirstName: "Bob",
  hasSpouse: true,
});

describe("incomePayload", () => {
  it("salary: earned income, name from owner, ends at owner retirement", () => {
    const p = incomePayload({ kind: "salary", owner: "client", amount: 200000 }, ctx);
    expect(p.type).toBe("salary");
    expect(p.name).toBe("Alice - Salary");
    expect(p.taxType).toBe("earned_income");
    expect(p.annualAmount).toBe(200000);
    expect(p.owner).toBe("client");
    expect(p.startYearRef).toBe("plan_start");
    expect(p.endYearRef).toBe("client_retirement");
    expect(p.startYear).toBe(2026);
    // client retires at 65 in 2030; end resolves to year-1 => 2029
    expect(p.endYear).toBe(2029);
    expect(p.growthSource).toBe("inflation");
  });

  it("pension: type=deferred, ordinary income, growth 0, retirement->end", () => {
    const p = incomePayload({ kind: "pension", owner: "spouse", amount: 40000 }, ctx);
    expect(p.type).toBe("deferred");
    expect(p.name).toBe("Bob - Pension");
    expect(p.taxType).toBe("ordinary_income");
    expect(p.growthRate).toBe("0");
    expect(p.growthSource).toBe("custom");
    expect(p.startYearRef).toBe("spouse_retirement");
    expect(p.endYearRef).toBe("spouse_end");
  });

  it("other: ordinary income, full plan span", () => {
    const p = incomePayload({ kind: "other", owner: "joint", amount: 12000 }, ctx);
    expect(p.type).toBe("other");
    expect(p.name).toBe("Joint - Other income");
    expect(p.taxType).toBe("ordinary_income");
    expect(p.startYearRef).toBe("plan_start");
    expect(p.endYearRef).toBe("plan_end");
  });
});
