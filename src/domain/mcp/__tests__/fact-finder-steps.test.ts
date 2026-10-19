// src/domain/mcp/__tests__/fact-finder-steps.test.ts
import { describe, it, expect } from "vitest";
import { FACT_FINDER_SECTIONS, MONTHS } from "@/lib/fact-finder/schema";
import { emptyRecordBook, type BookRecord, type RecordBook } from "@/lib/fact-finder/placement/types";
import { emptyFactFinderState, fixedRowId } from "@/lib/fact-finder/state";
import type { FactFinderState, FFRow } from "@/lib/fact-finder/types";
import { describeStep, FACT_FINDER_STEPS, rowsNeedingDecision } from "../fact-finder-steps";

const rec = (id: string, label: string, values: BookRecord["values"], facts?: BookRecord["facts"]): BookRecord => ({
  id,
  label,
  values,
  ...(facts ? { facts } : {}),
});

/** A new plan as createClientForHousehold seeds it, plus a few real records. */
function book(): RecordBook {
  const b = emptyRecordBook("c1");
  return {
    ...b,
    scenarioId: "base1",
    records: {
      ...b.records,
      account: [
        rec("acc-cash", "Household Cash", { name: "Household Cash", value: 0 }, { category: "cash", isDefaultChecking: true }),
        rec("acc-ira", "Schwab IRA ••4471", { name: "Schwab IRA", value: 380000 }, { category: "retirement", isDefaultChecking: false }),
        rec("acc-home", "Lake House", { name: "Lake House", value: 650000 }, { category: "real_estate", isDefaultChecking: false }),
        rec("acc-ann", "Jackson Annuity", { name: "Jackson Annuity", value: 90000 }, { category: "annuity", isDefaultChecking: false }),
      ],
      // The same annuity again, keyed by its account; an annuity row links to the account.
      annuity_contract: [rec("acc-ann", "Jackson Annuity", { costBasis: 60000 })],
      // An equity row links to a grant, not to the options account that holds it.
      stock_option_account: [rec("acc-opt", "Acme options", { name: "Acme options" })],
      stock_option_grant: [rec("grant-1", "Acme options RSU 2024-03-01", { grantType: "rsu" }, { accountId: "acc-opt" })],
      expense: [
        rec("exp-cur", "Current living", { isGoal: false }, { type: "living", livingSlot: "current" }),
        rec("exp-ret", "Retirement living", { isGoal: false }, { type: "living", livingSlot: "retirement" }),
        rec("exp-trip", "Trip to Japan", { isGoal: true }, { type: "other", livingSlot: null }),
        rec("exp-care", "Care for Mom", { isGoal: false }, { type: "other", livingSlot: null }),
      ],
      income: [
        rec("inc-ss1", "Mark's Social Security", { piaMonthly: 0 }, { type: "social_security", owner: "client" }),
        rec("inc-ss2", "Laura's Social Security", { piaMonthly: null }, { type: "social_security", owner: "spouse" }),
        rec("inc-ss3", "Old SS estimate", { piaMonthly: 2400 }, { type: "social_security", owner: "client" }),
        rec("inc-sal", "Acme salary", { annualAmount: 150000 }, { type: "salary", owner: "client" }),
      ],
    },
  };
}

describe("FACT_FINDER_STEPS", () => {
  it("puts every fact finder section except meta in exactly one step", () => {
    const placed = FACT_FINDER_STEPS.flatMap((s) => s.sectionIds);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(
      FACT_FINDER_SECTIONS.map((s) => s.id)
        .filter((id) => id !== "meta")
        .sort(),
    );
  });

  it("lists steps in Dan's order", () => {
    expect(FACT_FINDER_STEPS.map((s) => s.id)).toEqual([
      "household",
      "balance_sheet",
      "real_estate",
      "income",
      "savings",
      "goals",
      "living_expenses",
      "insurance",
      "estate",
    ]);
  });

  it("states the living-expense rule as what the field means", () => {
    const living = FACT_FINDER_STEPS.find((s) => s.id === "living_expenses")!;
    expect(living.guidance).toContain(
      "Living expenses are what the household spends after taxes, property taxes, insurance premiums, debt payments and the goals listed separately. When a figure includes any of those, take them out and say which.",
    );
  });
});

describe("describeStep", () => {
  it("marks the seeded Household Cash, default living rows and $0 Social Security rows", () => {
    const state = emptyFactFinderState();
    const balance = describeStep("balance_sheet", state, book()).existingRecords;
    expect(balance.filter((r) => r.seeded)).toEqual([
      { target: "account", recordId: "acc-cash", label: "Household Cash", seeded: true },
    ]);

    const income = describeStep("income", state, book()).existingRecords;
    expect(income.filter((r) => r.seeded).map((r) => r.recordId)).toEqual(["inc-ss1", "inc-ss2"]);
    expect(income.map((r) => r.recordId)).toEqual(["inc-ss1", "inc-ss2", "inc-ss3", "inc-sal"]);

    const living = describeStep("living_expenses", state, book()).existingRecords;
    expect(living).toEqual([
      { target: "expense", recordId: "exp-cur", label: "Current living", seeded: true },
      { target: "expense", recordId: "exp-ret", label: "Retirement living", seeded: true },
    ]);
  });

  // R22: one entry per record a row can link to — the record the section's rows link to.
  it("lists the balance sheet's records once each, as the records its rows link to", () => {
    expect(describeStep("balance_sheet", emptyFactFinderState(), book()).existingRecords).toEqual([
      { target: "account", recordId: "acc-cash", label: "Household Cash", seeded: true },
      { target: "account", recordId: "acc-ira", label: "Schwab IRA ••4471" },
      { target: "account", recordId: "acc-ann", label: "Jackson Annuity" },
      { target: "stock_option_grant", recordId: "grant-1", label: "Acme options RSU 2024-03-01" },
    ]);
  });

  // R21: the expenses section holds goals and every other expense outside living expenses.
  it("shows each step only its own records: real estate by category, goals as every expense but living", () => {
    const state = emptyFactFinderState();
    expect(describeStep("real_estate", state, book()).existingRecords).toEqual([
      { target: "account", recordId: "acc-home", label: "Lake House" },
    ]);
    expect(describeStep("goals", state, book()).existingRecords).toEqual([
      { target: "expense", recordId: "exp-trip", label: "Trip to Japan" },
      { target: "expense", recordId: "exp-care", label: "Care for Mom" },
    ]);
  });

  it("describes a section's columns with their options", () => {
    const view = describeStep("household", emptyFactFinderState(), book());
    expect(view.step).toEqual({
      id: "household",
      label: "Household",
      guidance: FACT_FINDER_STEPS[0].guidance,
    });
    expect(view.sections.map((s) => s.id)).toEqual(["people", "household", "family", "external"]);
    const people = view.sections.find((s) => s.id === "people")!;
    expect(people.layout).toBe("fixedRows");
    expect(people.fixedRows).toEqual(["Client", "Co-client"]);
    expect(people.columns.find((c) => c.id === "retirementAge")).toEqual({
      id: "retirementAge",
      label: "Retirement age",
      kind: "integer",
    });
    const month = people.columns.find((c) => c.id === "retirementMonth")!;
    expect(month.kind).toBe("choice");
    expect(month.options).toEqual(MONTHS);
    expect(month.options).toHaveLength(12);
    // A list section has no fixed rows to name.
    expect(view.sections.find((s) => s.id === "family")).not.toHaveProperty("fixedRows");
  });

  it("shows the draft's rows with their values and links, leaving out empty fixed rows", () => {
    const state: FactFinderState = emptyFactFinderState();
    const client: FFRow = {
      id: fixedRowId("people", "Client"),
      cells: { firstName: { value: "Mark", by: "chat", pinned: true }, lastName: { value: "", by: "chat", pinned: true } },
      sourceFileIds: [],
    };
    const child: FFRow = {
      id: "row-1",
      cells: { firstName: { value: "Ava", by: "chat", pinned: true } },
      link: { kind: "existing", recordId: "fm-1", score: 0.74, confirmed: false, by: "auto" },
      linkCandidates: [{ recordId: "fm-1", label: "Ava Check", score: 0.74 }],
      sourceFileIds: [],
    };
    const charity: FFRow = { id: "row-2", cells: {}, link: { kind: "new", by: "chat" }, sourceFileIds: [] };
    state.sections.people = [client, { id: fixedRowId("people", "Co-client"), cells: {}, sourceFileIds: [] }];
    state.sections.family = [child];
    state.sections.external = [charity];

    expect(describeStep("household", state, book()).draftRows).toEqual([
      { sectionId: "people", rowId: "people:Client", fixedRow: "Client", cells: { firstName: "Mark" }, link: null },
      {
        sectionId: "family",
        rowId: "row-1",
        cells: { firstName: "Ava" },
        link: { recordId: "fm-1", score: 0.74, confirmed: false },
      },
      { sectionId: "external", rowId: "row-2", cells: {}, link: "new" },
    ]);
  });
});

describe("rowsNeedingDecision", () => {
  it("names every row whose link waits on the advisor, with its candidates", () => {
    const state = emptyFactFinderState();
    state.sections.retirement = [
      {
        id: "row-ira",
        cells: { accountName: { value: "Fidelity IRA", by: "chat", pinned: true } },
        link: { kind: "existing", recordId: "acc-ira", score: 0.74, confirmed: false, by: "auto" },
        linkCandidates: [
          { recordId: "acc-ira", label: "Schwab IRA ••4471", score: 0.74 },
          { recordId: "acc-roth", label: "Roth IRA", score: 0.5 },
        ],
        sourceFileIds: [],
      },
      {
        id: "row-401k",
        cells: { accountName: { value: "401(k)", by: "chat", pinned: true } },
        link: { kind: "existing", recordId: "acc-401k", score: 0.95, confirmed: true, by: "auto" },
        sourceFileIds: [],
      },
    ];
    expect(rowsNeedingDecision(state)).toEqual([
      {
        sectionId: "retirement",
        rowId: "row-ira",
        label: "Fidelity IRA",
        candidates: [
          { recordId: "acc-ira", label: "Schwab IRA ••4471", score: 0.74 },
          { recordId: "acc-roth", label: "Roth IRA", score: 0.5 },
        ],
      },
    ]);
  });

  it("also names the rows a review refusal named, whatever their link", () => {
    const state = emptyFactFinderState();
    state.sections.retirement = [
      {
        id: "row-401k",
        cells: { accountName: { value: "401(k)", by: "chat", pinned: true } },
        link: { kind: "existing", recordId: "acc-401k", score: 0.95, confirmed: true, by: "auto" },
        sourceFileIds: [],
      },
      { id: "row-roth", cells: { accountName: { value: "Roth IRA", by: "chat", pinned: true } }, sourceFileIds: [] },
    ];
    expect(rowsNeedingDecision(state, ["row-401k"])).toEqual([
      { sectionId: "retirement", rowId: "row-401k", label: "401(k)", candidates: [] },
    ]);
  });
});
