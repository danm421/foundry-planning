import { describe, expect, it } from "vitest";
import { emptyImportPayload } from "../../types";
import { buildPlannerTools } from "../tools";

const CTX = {
  documentText: "Zach Martin retirement age 64. Mariah retirement age 60.",
  pages: ["page one text", "page two text"],
  payload: { ...emptyImportPayload(), incomes: [{ name: "Zach's Salary", type: "salary" as const, annualAmount: 145000, match: { kind: "new" as const } }] },
  estimatePia: () => 3200,
};

const MINIMAL = { version: 1, assumptions: {}, savings: [], socialSecurity: [], goals: [], incomeTiming: [], questions: [], notes: [] };

describe("buildPlannerTools", () => {
  it("exposes exactly the four tools", () => {
    const { tools } = buildPlannerTools(CTX);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "estimate_ss_pia", "list_extracted", "propose_decisions", "read_document",
    ]);
  });

  it("read_document returns a page slice", async () => {
    const { tools } = buildPlannerTools(CTX);
    const read = tools.find((t) => t.name === "read_document")!;
    const out = await read.invoke({ startPage: 2, endPage: 2 });
    expect(out).toContain("page two");
    expect(out).not.toContain("page one");
  });

  it("list_extracted returns the requested entity as JSON", async () => {
    const { tools } = buildPlannerTools(CTX);
    const list = tools.find((t) => t.name === "list_extracted")!;
    const out = JSON.parse(await list.invoke({ entity: "incomes" }));
    expect(out[0].name).toBe("Zach's Salary");
  });

  it("propose_decisions records a valid proposal", async () => {
    const { tools, getProposal } = buildPlannerTools(CTX);
    const propose = tools.find((t) => t.name === "propose_decisions")!;
    await propose.invoke({ decisions: MINIMAL });
    expect(getProposal()).toMatchObject({ version: 1 });
  });

  it("propose_decisions rejects a malformed proposal without recording it", async () => {
    const { tools, getProposal } = buildPlannerTools(CTX);
    const propose = tools.find((t) => t.name === "propose_decisions")!;
    const out = await propose.invoke({ decisions: { version: 99 } });
    expect(out).toContain("invalid");
    expect(getProposal()).toBeNull();
  });

  it("estimate_ss_pia delegates to the injected estimator", async () => {
    const { tools } = buildPlannerTools(CTX);
    const est = tools.find((t) => t.name === "estimate_ss_pia")!;
    const out = JSON.parse(await est.invoke({
      highestAnnualSalary: 166750, yearsEmployed: 17, futureYears: 25,
    }));
    expect(out.piaMonthly).toBe(3200);
  });
});
