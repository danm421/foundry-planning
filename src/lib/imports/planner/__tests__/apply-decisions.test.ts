import { describe, expect, it } from "vitest";
import { emptyImportPayload } from "../../types";
import { emptyPlanBasics } from "../../assemble/plan-basics";
import { emptyGoals } from "../../assemble/goals";
import { stated } from "../../assemble/field";
import { applyDecisions } from "../apply-decisions";
import type { PlanningDecisions } from "../types";

const EMPTY: PlanningDecisions = {
  version: 1, assumptions: {}, savings: [], socialSecurity: [],
  goals: [], incomeTiming: [], questions: [], notes: [],
};
const KNOWN = { hasSpouse: true, primaryDob: "1987-11-21", spouseDob: "1989-09-25" };

describe("applyDecisions", () => {
  it("writes retirement ages onto planBasics with their reasons", () => {
    const { payload } = applyDecisions({
      payload: emptyImportPayload(),
      known: KNOWN,
      decisions: {
        ...EMPTY,
        assumptions: {
          retirementAge: { value: 64, provenance: "document", reason: "Stated in the Profile table." },
          spouseRetirementAge: { value: 60, provenance: "derived", reason: "Document states 60-62; planned at the earlier end." },
        },
      },
    });
    expect(payload.planBasics?.retirementAge).toEqual({
      value: 64, provenance: "document", reason: "Stated in the Profile table.",
    });
    expect(payload.planBasics?.spouseRetirementAge?.value).toBe(60);
  });

  it("adds a savings row the planner found in prose", () => {
    const { payload } = applyDecisions({
      payload: emptyImportPayload(),
      known: KNOWN,
      decisions: {
        ...EMPTY,
        savings: [{
          accountName: "Zach 401(k)", owner: "client",
          annualPercent: { value: 0.1, provenance: "document", reason: "Contributing 10%." },
          employerMatchPct: { value: 1, provenance: "derived", reason: "4% company match read as dollar-for-dollar on the first 4%." },
          employerMatchCap: { value: 0.04, provenance: "document", reason: "Company match 4%." },
          dedicatedAccountNames: [],
        } as never],
      },
    });
    expect(payload.savings).toHaveLength(1);
    expect(payload.savings[0]).toMatchObject({
      destinationAccountName: "Zach 401(k)", annualPercent: 0.1, employerMatchCap: 0.04,
    });
  });

  it("a planner savings decision replaces the extracted row for the same account", () => {
    const base = {
      ...emptyImportPayload(),
      savings: [{
        name: "extracted", destinationAccountName: "Zach 401(k)",
        annualPercent: 0.03, match: { kind: "new" as const },
      }],
    };
    const { payload } = applyDecisions({
      payload: base, known: KNOWN,
      decisions: {
        ...EMPTY,
        savings: [{
          accountName: "Zach 401(k)", owner: "client",
          annualPercent: { value: 0.1, provenance: "document", reason: "Contributing 10%." },
        } as never],
      },
    });
    expect(payload.savings).toHaveLength(1);
    expect(payload.savings[0].annualPercent).toBe(0.1);
  });

  it("applies an income timing override by name", () => {
    const base = {
      ...emptyImportPayload(),
      incomes: [{ name: "Zach's Salary", type: "salary" as const, endYearRef: "client_retirement" as const, match: { kind: "new" as const } }],
    };
    const { payload } = applyDecisions({
      payload: base, known: KNOWN,
      decisions: {
        ...EMPTY,
        incomeTiming: [{
          incomeName: "Zach's Salary",
          endYearRef: { value: "client_ss_70", provenance: "document", reason: "Plans to consult until 70." },
        }],
      },
    });
    expect(payload.incomes[0].endYearRef).toBe("client_ss_70");
  });

  it("converts planner questions to assemble questions", () => {
    const { questions } = applyDecisions({
      payload: emptyImportPayload(), known: KNOWN,
      decisions: {
        ...EMPTY,
        questions: [{ id: "q:retirement_age", field: "client.retirementAge", prompt: "What retirement age?", options: ["62", "64"] }],
      },
    });
    expect(questions).toEqual([{
      id: "q:retirement_age", kind: "missing", field: "client.retirementAge",
      prompt: "What retirement age?", options: ["62", "64"],
    }]);
  });

  it("writes social security onto planBasics", () => {
    const { payload } = applyDecisions({
      payload: emptyImportPayload(), known: KNOWN,
      decisions: {
        ...EMPTY,
        socialSecurity: [{
          owner: "client", basis: "estimated_from_income",
          piaMonthly: { value: 3200, provenance: "derived", reason: "Estimated from $166,750 over 35 years." },
          claimingAge: { value: 64, provenance: "document", reason: "Start collecting at retirement." },
        }],
      },
    });
    expect(payload.planBasics?.socialSecurity[0]).toMatchObject({ owner: "client" });
    expect(payload.planBasics?.socialSecurity[0].pia.value).toBe(3200);
  });

  it("is pure - the input payload is not mutated", () => {
    const input = emptyImportPayload();
    applyDecisions({
      payload: input, known: KNOWN,
      decisions: { ...EMPTY, assumptions: { retirementAge: { value: 64, provenance: "document", reason: "x" } } },
    });
    expect(input.planBasics).toBeUndefined();
  });

  // ── R5: authorized additional coverage beyond the brief's seven ──

  it("does not overwrite a planBasics field whose provenance is already 'stated'", () => {
    const base = {
      ...emptyImportPayload(),
      planBasics: {
        ...emptyPlanBasics(),
        retirementAge: { value: 67, provenance: "stated" as const },
      },
    };
    const { payload } = applyDecisions({
      payload: base, known: KNOWN,
      decisions: {
        ...EMPTY,
        assumptions: {
          retirementAge: { value: 64, provenance: "document", reason: "Stated in the Profile table." },
        },
      },
    });
    expect(payload.planBasics?.retirementAge).toEqual({ value: 67, provenance: "stated" });
  });

  it("matches a planner savings decision to an extracted row despite case and punctuation differences", () => {
    const base = {
      ...emptyImportPayload(),
      savings: [{
        name: "extracted", destinationAccountName: "ZACH 401K",
        annualPercent: 0.03, match: { kind: "new" as const },
      }],
    };
    const { payload } = applyDecisions({
      payload: base, known: KNOWN,
      decisions: {
        ...EMPTY,
        savings: [{
          accountName: "Zach 401(k)", owner: "client",
          annualPercent: { value: 0.1, provenance: "document", reason: "Contributing 10%." },
        } as never],
      },
    });
    expect(payload.savings).toHaveLength(1);
    expect(payload.savings[0].annualPercent).toBe(0.1);
  });

  it("clears an existing endYear when an income timing override sets endYearRef, so the ref wins", () => {
    const base = {
      ...emptyImportPayload(),
      incomes: [{ name: "Zach's Salary", type: "salary" as const, endYear: 2050, match: { kind: "new" as const } }],
    };
    const { payload } = applyDecisions({
      payload: base, known: KNOWN,
      decisions: {
        ...EMPTY,
        incomeTiming: [{
          incomeName: "Zach's Salary",
          endYearRef: { value: "client_ss_70", provenance: "document", reason: "Plans to consult until 70." },
        }],
      },
    });
    expect(payload.incomes[0].endYearRef).toBe("client_ss_70");
    expect(payload.incomes[0].endYear).toBeUndefined();
  });

  it("appends an education goal and a one_time expense from goal decisions", () => {
    const { payload } = applyDecisions({
      payload: emptyImportPayload(), known: KNOWN,
      decisions: {
        ...EMPTY,
        goals: [
          {
            kind: "education",
            name: { value: "Zach College", provenance: "derived", reason: "Named for the funding 529." },
            annualAmount: { value: 30000, provenance: "estimated", reason: "Advisor-provided estimate." },
            startYear: { value: 2032, provenance: "document", reason: "First year of college stated in the plan." },
            endYear: { value: 2035, provenance: "document", reason: "Last year of college stated in the plan." },
            dedicatedAccountNames: ["Zach 529"],
          },
          {
            kind: "one_time",
            name: { value: "New Roof", provenance: "document", reason: "Stated as a planned expense." },
            annualAmount: { value: 25000, provenance: "document", reason: "Stated cost." },
            startYear: { value: 2030, provenance: "document", reason: "Stated year." },
            endYear: { value: 2030, provenance: "document", reason: "One-time, so ends the same year." },
            dedicatedAccountNames: [],
          },
        ],
      },
    });

    expect(payload.goals?.education).toHaveLength(1);
    expect(payload.goals?.education[0].id).toBe("edu:zach-college");
    expect(payload.goals?.education[0].name).toEqual({
      value: "Zach College", provenance: "derived", reason: "Named for the funding 529.",
    });

    expect(payload.expenses).toHaveLength(1);
    expect(payload.expenses[0]).toMatchObject({
      name: "New Roof", type: "other", annualAmount: 25000, startYear: 2030, endYear: 2030,
      match: { kind: "new" },
    });
  });

  // ── Coordinator fix round: riskTolerance was silently dropped ──

  it("writes a riskTolerance decision onto goals.riskTolerance", () => {
    const { payload } = applyDecisions({
      payload: emptyImportPayload(), known: KNOWN,
      decisions: {
        ...EMPTY,
        assumptions: {
          riskTolerance: { value: "moderate", provenance: "document", reason: "Stated as 'Moderate' on the risk questionnaire." },
        },
      },
    });
    expect(payload.goals?.riskTolerance).toEqual({
      value: "moderate", provenance: "document", reason: "Stated as 'Moderate' on the risk questionnaire.",
    });
  });

  it("does not overwrite a riskTolerance whose existing provenance is already 'stated'", () => {
    const base = {
      ...emptyImportPayload(),
      goals: { ...emptyGoals(), riskTolerance: stated<string>("aggressive") },
    };
    const { payload } = applyDecisions({
      payload: base, known: KNOWN,
      decisions: {
        ...EMPTY,
        assumptions: {
          riskTolerance: { value: "moderate", provenance: "document", reason: "Stated as 'Moderate' on the risk questionnaire." },
        },
      },
    });
    expect(payload.goals?.riskTolerance).toEqual({ value: "aggressive", provenance: "stated" });
  });

  // ── Coordinator fix round: Rule 3's replace-by-owner path was untested ──

  it("replaces an existing client Social Security entry, leaving exactly one client entry", () => {
    const base = {
      ...emptyImportPayload(),
      planBasics: {
        ...emptyPlanBasics(),
        socialSecurity: [
          { owner: "client" as const, pia: { value: 2000, provenance: "document" as const }, claimingAge: { value: 67, provenance: "document" as const } },
        ],
      },
    };
    const { payload } = applyDecisions({
      payload: base, known: KNOWN,
      decisions: {
        ...EMPTY,
        socialSecurity: [{
          owner: "client", basis: "estimated_from_income",
          piaMonthly: { value: 3200, provenance: "derived", reason: "Estimated from $166,750 over 35 years." },
          claimingAge: { value: 64, provenance: "document", reason: "Start collecting at retirement." },
        }],
      },
    });
    const clientEntries = (payload.planBasics?.socialSecurity ?? []).filter((e) => e.owner === "client");
    expect(clientEntries).toHaveLength(1);
    expect(clientEntries[0].pia.value).toBe(3200);
    expect(clientEntries[0].claimingAge.value).toBe(64);
  });

  it("preserves an existing spouse Social Security entry when only a client decision is provided", () => {
    const spouseEntry = {
      owner: "spouse" as const,
      pia: { value: 1500, provenance: "document" as const },
      claimingAge: { value: 65, provenance: "document" as const },
    };
    const base = {
      ...emptyImportPayload(),
      planBasics: { ...emptyPlanBasics(), socialSecurity: [spouseEntry] },
    };
    const { payload } = applyDecisions({
      payload: base, known: KNOWN,
      decisions: {
        ...EMPTY,
        socialSecurity: [{
          owner: "client", basis: "estimated_from_income",
          piaMonthly: { value: 3200, provenance: "derived", reason: "Estimated from $166,750 over 35 years." },
          claimingAge: { value: 64, provenance: "document", reason: "Start collecting at retirement." },
        }],
      },
    });
    const spouseEntries = (payload.planBasics?.socialSecurity ?? []).filter((e) => e.owner === "spouse");
    expect(spouseEntries).toEqual([spouseEntry]);
  });
});

// R2 half 1 (whole-branch review, C2). `ExtractedSavings.destinationAccountName`
// is declared REQUIRED, but a savings row reaches this fold straight from raw
// LLM extraction, cast through `extraction-schema.ts`'s `z.looseObject({})`,
// which validates no field at all. Rule 2's filter called
// `accountKey(row.destinationAccountName)` bare, so a row with no destination
// threw `undefined.toLowerCase()` out of a "pure fold" and took the whole
// assemble down. The `as never` casts below are the point: they stand in for
// the unvalidated boundary the type system cannot see across.
describe("applyDecisions — Rule 2 against unvalidated extracted savings", () => {
  /** A raw extracted savings row with NO `destinationAccountName`. */
  const NO_DESTINATION = {
    name: "Employer contribution",
    annualPercent: 0.04,
    match: { kind: "new" as const },
  };

  it("does not throw on a savings row with no destinationAccountName, even with zero decisions", () => {
    // Zero savings decisions: the filter still runs over every row, which is
    // why an empty `decisions.savings` was no protection.
    const base = { ...emptyImportPayload(), savings: [NO_DESTINATION as never] };
    expect(() =>
      applyDecisions({ payload: base, known: KNOWN, decisions: EMPTY }),
    ).not.toThrow();
  });

  it("keeps the destination-less row — it matches no decision, so nothing replaces it", () => {
    const base = { ...emptyImportPayload(), savings: [NO_DESTINATION as never] };
    const { payload } = applyDecisions({
      payload: base,
      known: KNOWN,
      decisions: {
        ...EMPTY,
        savings: [{
          accountName: "Zach 401(k)", owner: "client",
          annualPercent: { value: 0.1, provenance: "document", reason: "Contributing 10%." },
          dedicatedAccountNames: [],
        } as never],
      },
    });
    // The unnamed row survives alongside the decision's new row: `""` must not
    // collide with a real account key.
    expect(payload.savings).toHaveLength(2);
    expect(payload.savings.map((r) => r.destinationAccountName)).toEqual([
      undefined,
      "Zach 401(k)",
    ]);
  });

  it("still replaces a NAMED extracted row while a destination-less sibling is present", () => {
    // Pins that the `?? ""` guard did not defang Rule 2's actual job.
    const base = {
      ...emptyImportPayload(),
      savings: [
        NO_DESTINATION as never,
        { name: "extracted", destinationAccountName: "Zach 401(k)", annualPercent: 0.03, match: { kind: "new" as const } },
      ],
    };
    const { payload } = applyDecisions({
      payload: base,
      known: KNOWN,
      decisions: {
        ...EMPTY,
        savings: [{
          accountName: "zach 401k", owner: "client",
          annualPercent: { value: 0.1, provenance: "document", reason: "Contributing 10%." },
          dedicatedAccountNames: [],
        } as never],
      },
    });
    expect(payload.savings).toHaveLength(2);
    expect(payload.savings[0].destinationAccountName).toBeUndefined();
    expect(payload.savings[1]).toMatchObject({
      destinationAccountName: "zach 401k",
      annualPercent: 0.1,
    });
  });
});
