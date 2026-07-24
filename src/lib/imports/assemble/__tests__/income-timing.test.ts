import { describe, expect, it } from "vitest";
import { emptyImportPayload, type ImportPayload } from "../../types";
import { applyIncomeTimingDefaults } from "../income-timing";

function payloadWithIncomes(rows: ImportPayload["incomes"]): ImportPayload {
  return { ...emptyImportPayload(), incomes: rows };
}

describe("applyIncomeTimingDefaults", () => {
  it("stamps client_retirement on a salary with no end ref", () => {
    const { payload } = applyIncomeTimingDefaults(
      payloadWithIncomes([
        { name: "Zach's Salary", type: "salary", owner: "client", annualAmount: 145000, match: { kind: "new" } },
      ]),
    );
    expect(payload.incomes[0].endYearRef).toBe("client_retirement");
    expect(payload.incomes[0].startYearRef).toBe("plan_start");
  });

  it("stamps spouse_retirement for a spouse salary", () => {
    const { payload } = applyIncomeTimingDefaults(
      payloadWithIncomes([
        { name: "Mariah's Salary", type: "salary", owner: "spouse", annualAmount: 102000, match: { kind: "new" } },
      ]),
    );
    expect(payload.incomes[0].endYearRef).toBe("spouse_retirement");
  });

  it("normalizes a salary the document ended at death", () => {
    const { payload, normalized } = applyIncomeTimingDefaults(
      payloadWithIncomes([
        { name: "Salary - Janet", type: "salary", owner: "spouse", endYearRef: "spouse_end", endYear: 2080, match: { kind: "new" } },
      ]),
    );
    expect(payload.incomes[0].endYearRef).toBe("spouse_retirement");
    expect(payload.incomes[0].endYear).toBeUndefined();
    expect(payload.incomes[0].startYearRef).toBe("plan_start");
    expect(normalized).toHaveLength(1);
    expect(normalized[0].statedRef).toBe("spouse_end");
    expect(normalized[0].reason).toContain("data-entry error");
  });

  it("still backfills a blank start ref on a row normalized by rule 2", () => {
    const { payload, normalized } = applyIncomeTimingDefaults(
      payloadWithIncomes([
        { name: "Zach's Salary", type: "salary", owner: "client", endYearRef: "client_end", match: { kind: "new" } },
      ]),
    );
    expect(payload.incomes[0].startYearRef).toBe("plan_start");
    expect(payload.incomes[0].endYearRef).toBe("client_retirement");
    expect(normalized).toHaveLength(1);
  });

  it("leaves a plausible earning-stop ref alone", () => {
    const { payload, normalized } = applyIncomeTimingDefaults(
      payloadWithIncomes([
        { name: "Zach's Salary", type: "salary", owner: "client", endYearRef: "client_ss_70", match: { kind: "new" } },
      ]),
    );
    expect(payload.incomes[0].endYearRef).toBe("client_ss_70");
    expect(normalized).toHaveLength(0);
  });

  it("does not touch social security rows", () => {
    const { payload } = applyIncomeTimingDefaults(
      payloadWithIncomes([
        { name: "Zach SS", type: "social_security", owner: "client", match: { kind: "new" } },
      ]),
    );
    expect(payload.incomes[0].endYearRef).toBe("client_end");
  });

  it("is pure - the input payload is not mutated", () => {
    const input = payloadWithIncomes([
      { name: "Zach's Salary", type: "salary", owner: "client", match: { kind: "new" } },
    ]);
    applyIncomeTimingDefaults(input);
    expect(input.incomes[0].endYearRef).toBeUndefined();
  });
});
