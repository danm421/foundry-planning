// src/lib/fact-finder/placement/map/__tests__/income.test.ts
import { describe, expect, it } from "vitest";
import { findSection } from "../../../schema";
import type { FFRow } from "../../../types";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import { NO_CO_CLIENT_REASON } from "../../refs";
import { diffDrafts } from "../../diff";
import type { RecordBook } from "../../types";
import { validateLines } from "../../validate";
import { columnFeeding } from "../index";
import { INCOME_MAP, SALARY_MAP, SS_MAP } from "../income";
import type { SectionMap } from "../types";

const cell = (sectionId: string, rowId: string, columnId: string) => ({ sectionId, rowId, columnId });
const facts = (type: string, owner: string) => ({ type, owner, ownerAccountId: null });
const CO_CLIENT_CELL = cell("people", "people:Co-client", "firstName");

const markSalary = recordOf(
  "sal-1", "Salary — Acme Corp", { name: "Salary — Acme Corp", annualAmount: 150000, end: { yearRef: "client_retirement" } }, facts("salary", "client"),
);
const lauraSalary = recordOf("sal-2", "Salary — Brightside", { name: "Salary — Brightside", annualAmount: 98000 }, facts("salary", "spouse"));
const markSs = recordOf("ss-1", "Social Security — Mark", { ssBenefitMode: "pia_at_fra", piaMonthly: null }, facts("social_security", "client"));
const lauraSs = recordOf("ss-2", "Social Security — Laura", { ssBenefitMode: null, piaMonthly: null }, facts("social_security", "spouse"));
const pension = recordOf("inc-1", "Acme pension", { name: "Acme pension", type: "deferred", owner: "client" }, facts("deferred", "client"));

/** `map` places `rows` against `book`; the fact finder also holds `sections`. `removed`: "rowId:columnId" cells the runner took out (they didn't read). */
function place(map: SectionMap, rows: FFRow[], book: RecordBook, sections: Record<string, FFRow[]> = {}, removed: string[] = []) {
  const { ctx } = contextOf(stateWith({ ...sections, [map.sectionId]: rows }), book);
  return map.place(rows, { ...ctx, removed: (rowId, columnId) => removed.includes(`${rowId}:${columnId}`) });
}

describe("placements", () => {
  it.each([SALARY_MAP, SS_MAP, INCOME_MAP])("$sectionId places every column exactly once", (map) => {
    expect(Object.keys(map.placements).sort()).toEqual(findSection(map.sectionId)?.columns.map((c) => c.id).sort());
  });
});

describe("SALARY_MAP", () => {
  const from = (rowId: string, columnId: string) => [cell("salary", rowId, columnId)];

  it("a filled Client row updates the salary on record and puts the employer on the household", () => {
    const row = rowOf(
      "salary:Client",
      { employer: "Acme Corp", annualSalary: 165000, annualRaise: 3.5, startYear: 2020, endYear: 2040 },
      { link: linkedTo("sal-1") },
    );
    expect(place(SALARY_MAP, [row], hendricksBook({ income: [markSalary] }))).toEqual([
      {
        lineId: "salary:Client/client_household", sectionId: "salary", rowId: "salary:Client", target: "client_household",
        recordId: "c1", label: "Employer — Mark Hendricks",
        fields: [{ key: "employer", value: "Acme Corp", from: from("salary:Client", "employer") }],
        warnings: [],
      },
      {
        lineId: "salary:Client/income", sectionId: "salary", rowId: "salary:Client", target: "income",
        recordId: "sal-1", label: "Salary — Mark Hendricks",
        fields: [
          { key: "annualAmount", value: 165000, from: from("salary:Client", "annualSalary") },
          { key: "growthRate", value: 0.035, from: from("salary:Client", "annualRaise"), with: { growthSource: "custom" } },
          { key: "start", value: 2020, from: from("salary:Client", "startYear") },
          { key: "end", value: 2040, from: from("salary:Client", "endYear") },
        ],
        warnings: [],
      },
    ]);
  });

  it("a new Co-client salary starts this year, stops at the co-client's retirement and grows with inflation", () => {
    const row = rowOf("salary:Co-client", { employer: "Brightside Health", annualSalary: 98000 });
    const [household, income] = place(SALARY_MAP, [row], hendricksBook());
    expect(household.fields).toEqual([{ key: "spouseEmployer", value: "Brightside Health", from: from("salary:Co-client", "employer") }]);
    expect(income).toMatchObject({
      recordId: null,
      label: "Salary — Laura Hendricks",
      fixed: { type: "salary", owner: "spouse", name: "Salary — Brightside Health", growthSource: "inflation" },
      fields: [
        { key: "annualAmount", value: 98000 },
        { key: "start", value: 2026, from: [] },
        { key: "end", value: { yearRef: "spouse_retirement" }, from: [] },
      ],
    });
  });

  it("a new salary with a raise grows at it; with no employer it's named Salary and the household isn't touched", () => {
    const drafts = place(SALARY_MAP, [rowOf("salary:Client", { annualSalary: 120000, annualRaise: 3 })], hendricksBook());
    expect(drafts.map((d) => d.target)).toEqual(["income"]);
    expect(drafts[0].fixed).toEqual({ type: "salary", owner: "client", name: "Salary" });
    expect(drafts[0].fields[1]).toEqual({ key: "growthRate", value: 0.03, from: from("salary:Client", "annualRaise"), with: { growthSource: "custom" } });
  });

  it("on a salary on record, a blank cell makes no field — and no default years", () => {
    const row = rowOf("salary:Client", { employer: null, annualSalary: 170000, annualRaise: null, startYear: null }, { link: linkedTo("sal-1") });
    const drafts = place(SALARY_MAP, [row], hendricksBook({ income: [markSalary] }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].fields).toEqual([{ key: "annualAmount", value: 170000, from: from("salary:Client", "annualSalary") }]);
    expect(drafts[0].fixed).toBeUndefined();
  });

  it("a Start or End year that didn't read gets no default — validation asks for it at that cell", () => {
    const row = rowOf("salary:Client", { annualSalary: 120000 });
    const [income] = place(SALARY_MAP, [row], hendricksBook(), {}, ["salary:Client:startYear", "salary:Client:endYear"]);
    expect(income.fields.map((f) => f.key)).toEqual(["annualAmount"]);
    const [line] = validateLines(diffDrafts([income], hendricksBook()), (l, key) => columnFeeding(l.sectionId, l.target, key));
    expect(line.blocked?.cell).toEqual(cell("salary", "salary:Client", "startYear"));
    // Only the end didn't read: the start still defaults.
    const [endOnly] = place(SALARY_MAP, [row], hendricksBook(), {}, ["salary:Client:endYear"]);
    expect(endOnly.fields.map((f) => f.key)).toEqual(["annualAmount", "start"]);
  });

  it("an Annual raise % that didn't read: the new salary grows with inflation, and the line says so", () => {
    const [income] = place(SALARY_MAP, [rowOf("salary:Client", { annualSalary: 120000 })], hendricksBook(), {}, ["salary:Client:annualRaise"]);
    expect(income.fixed).toMatchObject({ growthSource: "inflation" });
    expect(income.warnings).toEqual(['"Annual raise %" didn\'t read — this salary grows with inflation until you set it.']);
    // A truly blank raise says nothing.
    expect(place(SALARY_MAP, [rowOf("salary:Client", { annualSalary: 120000 })], hendricksBook())[0].warnings).toEqual([]);
  });

  it("an employer alone is only the household line", () => {
    const drafts = place(SALARY_MAP, [rowOf("salary:Client", { employer: "Acme Corp" }, { link: linkedTo("sal-1") })], hendricksBook({ income: [markSalary] }));
    expect(drafts.map((d) => d.lineId)).toEqual(["salary:Client/client_household"]);
  });

  it("a link to a record not in the book, or to an income that isn't this person's salary, never updates it", () => {
    const book = hendricksBook({ income: [markSalary, lauraSalary, markSs] });
    for (const recordId of ["sal-of-another-client", "sal-2", "ss-1"]) {
      const row = rowOf("salary:Client", { annualSalary: 165000 }, { link: linkedTo(recordId) });
      expect(place(SALARY_MAP, [row], book)[0].recordId).toBeNull();
    }
  });

  it("a Co-client row on a household with no co-client is blocked — the fix is on the Household page", () => {
    const row = rowOf("salary:Co-client", { employer: "Brightside Health", annualSalary: 98000 });
    expect(place(SALARY_MAP, [row], bookWith({})).map((d) => d.blocked)).toEqual([
      { reason: NO_CO_CLIENT_REASON, cell: CO_CLIENT_CELL },
      { reason: NO_CO_CLIENT_REASON, cell: CO_CLIENT_CELL },
    ]);
  });

  it("a co-client the fact finder names is enough", () => {
    const row = rowOf("salary:Co-client", { annualSalary: 98000 });
    const [income] = place(SALARY_MAP, [row], bookWith({}), { people: [rowOf("people:Co-client", { firstName: "Laura" })] });
    expect(income.blocked).toBeUndefined();
    expect(income.label).toBe("Salary — Laura");
  });
});

describe("SS_MAP", () => {
  const from = (rowId: string, columnId: string) => [cell("ss", rowId, columnId)];

  it("a stated benefit: × 12 into the annual amount, the age it's quoted at, a claim age and a COLA", () => {
    const row = rowOf(
      "ss:Client",
      {
        benefitSource: "Stated benefit at age", monthlyBenefit: 2450.5, benefitStatedAtAge: 67, whenToClaim: "At a specific age",
        claimAgeYears: "68", claimAgeMonths: 6, cola: 2.5,
      },
      { link: linkedTo("ss-1") },
    );
    expect(place(SS_MAP, [row], hendricksBook({ income: [markSs] }))).toEqual([
      {
        lineId: "ss:Client/income", sectionId: "ss", rowId: "ss:Client", target: "income", recordId: "ss-1",
        label: "Social Security — Mark Hendricks",
        fields: [
          { key: "ssBenefitMode", value: "manual_amount", from: from("ss:Client", "benefitSource") },
          { key: "annualAmount", value: 29406, from: from("ss:Client", "monthlyBenefit"), with: { ssAmountUnit: "monthly" } },
          { key: "ssStatedAge", value: 67, from: from("ss:Client", "benefitStatedAtAge"), with: { ssStatedAgeMonths: 0 } },
          { key: "claimingAgeMode", value: "years", from: from("ss:Client", "whenToClaim") },
          { key: "claimingAge", value: 68, from: from("ss:Client", "claimAgeYears"), with: { claimingAgeMode: "years" } },
          { key: "claimingAgeMonths", value: 6, from: from("ss:Client", "claimAgeMonths"), with: { claimingAgeMode: "years" } },
          { key: "growthRate", value: 0.025, from: from("ss:Client", "cola"), with: { growthSource: "custom" } },
        ],
        warnings: [],
      },
    ]);
  });

  it("a benefit at full retirement age is the PIA; a stated age doesn't apply to it; a blank cell makes no field", () => {
    const row = rowOf("ss:Client", { benefitSource: "Benefit at full retirement age", monthlyBenefit: 3200, benefitStatedAtAge: 67, cola: null });
    const [draft] = place(SS_MAP, [row], hendricksBook({ income: [markSs] }));
    expect(draft.fields).toEqual([
      { key: "ssBenefitMode", value: "pia_at_fra", from: from("ss:Client", "benefitSource") },
      { key: "piaMonthly", value: 3200, from: from("ss:Client", "monthlyBenefit") },
    ]);
    expect(draft.warnings).toEqual(['Benefit stated at age is used only with "Stated benefit at age" — it wasn\'t saved.']);
  });

  it("with no benefit source, the amount goes where the record's own mode reads it", () => {
    const book = hendricksBook({ income: [markSs, lauraSs] });
    const drafts = place(SS_MAP, [rowOf("ss:Client", { monthlyBenefit: 3200 }), rowOf("ss:Co-client", { monthlyBenefit: 1500 })], book);
    expect(drafts.map((d) => [d.recordId, d.fields])).toEqual([
      ["ss-1", [{ key: "piaMonthly", value: 3200, from: from("ss:Client", "monthlyBenefit") }]],
      ["ss-2", [{ key: "annualAmount", value: 18000, from: from("ss:Co-client", "monthlyBenefit"), with: { ssAmountUnit: "monthly" } }]],
    ]);
  });

  it("estimate from salary: the Social Security dialog's estimate from the Salary row's salary", () => {
    const ss = rowOf("ss:Client", { benefitSource: "Estimate from salary", monthlyBenefit: 2000 });
    const salary = rowOf("salary:Client", { annualSalary: 165000 });
    const [draft] = place(SS_MAP, [ss], hendricksBook({ income: [markSs, markSalary] }), { salary: [salary] });
    expect(draft.fields).toEqual([
      { key: "ssBenefitMode", value: "pia_at_fra", from: from("ss:Client", "benefitSource") },
      { key: "piaMonthly", value: 4030, from: [cell("ss", "ss:Client", "benefitSource"), cell("salary", "salary:Client", "annualSalary")] },
    ]);
    expect(draft.warnings).toEqual(["The monthly benefit isn't used when it's estimated from salary — it wasn't saved."]);
  });

  it("estimate from salary falls back to the salary on record, and blocks on the Salary row with none", () => {
    const book = hendricksBook({ income: [markSs, lauraSs, markSalary] });
    const rows = [rowOf("ss:Client", { benefitSource: "Estimate from salary" }), rowOf("ss:Co-client", { benefitSource: "Estimate from salary" })];
    const [mark, laura] = place(SS_MAP, rows, book);
    expect(mark.fields[1]).toEqual({ key: "piaMonthly", value: 3843, from: from("ss:Client", "benefitSource") });
    expect(mark.blocked).toBeUndefined();
    expect(laura.blocked).toEqual({ reason: "Estimate from salary needs this person's salary.", cell: cell("salary", "salary:Co-client", "annualSalary") });
  });

  it("no benefit saves no amount", () => {
    const [draft] = place(SS_MAP, [rowOf("ss:Client", { benefitSource: "No benefit", monthlyBenefit: 3200 })], hendricksBook({ income: [markSs] }));
    expect(draft.fields).toEqual([{ key: "ssBenefitMode", value: "no_benefit", from: from("ss:Client", "benefitSource") }]);
    expect(draft.warnings).toEqual(['The monthly benefit isn\'t saved: the benefit is set to "No benefit".']);
  });

  it("a claim age with another When to claim isn't saved; a blank When to claim makes it a specific age", () => {
    const book = hendricksBook({ income: [markSs, lauraSs] });
    const [mark, laura] = place(
      SS_MAP,
      [rowOf("ss:Client", { whenToClaim: "At full retirement age", claimAgeYears: "68" }), rowOf("ss:Co-client", { claimAgeYears: "70" })],
      book,
    );
    expect(mark.fields).toEqual([{ key: "claimingAgeMode", value: "fra", from: from("ss:Client", "whenToClaim") }]);
    expect(mark.warnings).toEqual(['The claim age isn\'t saved: When to claim is "At full retirement age".']);
    expect(laura.fields).toEqual([
      { key: "claimingAgeMode", value: "years", from: from("ss:Co-client", "claimAgeYears") },
      { key: "claimingAge", value: 70, from: from("ss:Co-client", "claimAgeYears"), with: { claimingAgeMode: "years" } },
    ]);
  });

  it("a typed claim age equal to the seeded 67 on a record claiming at full retirement age still makes it a specific age", () => {
    const fraAt67 = recordOf(
      "ss-1", "Social Security — Mark", { ssBenefitMode: "pia_at_fra", claimingAgeMode: "fra", claimingAge: 67, claimingAgeMonths: 0 },
      facts("social_security", "client"),
    );
    const book = hendricksBook({ income: [fraAt67] });
    const drafts = place(SS_MAP, [rowOf("ss:Client", { claimAgeYears: "67" })], book);
    expect(drafts[0].fields).toEqual([
      { key: "claimingAgeMode", value: "years", from: from("ss:Client", "claimAgeYears") },
      { key: "claimingAge", value: 67, from: from("ss:Client", "claimAgeYears"), with: { claimingAgeMode: "years" } },
    ]);
    // The diff sees the mode change even though the age is the same: the line isn't "No changes".
    const [line] = diffDrafts(drafts, book);
    expect([line.action, line.fields.map((f) => [f.key, f.onRecord, f.next])]).toEqual(["update", [["claimingAgeMode", "fra", "years"]]]);

    // Months alone count as a claim age too.
    const months = place(SS_MAP, [rowOf("ss:Client", { claimAgeMonths: 6 })], book)[0];
    expect(months.fields[0]).toEqual({ key: "claimingAgeMode", value: "years", from: from("ss:Client", "claimAgeMonths") });
  });

  it("a stated age outside 62–70 and claim months outside 0–11 aren't saved", () => {
    const row = rowOf("ss:Client", { benefitSource: "Stated benefit at age", benefitStatedAtAge: 72, claimAgeYears: "67", claimAgeMonths: 14 });
    const [draft] = place(SS_MAP, [row], hendricksBook({ income: [markSs] }));
    expect(draft.fields.map((f) => f.key)).toEqual(["ssBenefitMode", "claimingAgeMode", "claimingAge"]);
    expect(draft.fields[1].from).toEqual(from("ss:Client", "claimAgeYears"));   // not from the months it didn't save
    expect(draft.warnings).toEqual([
      "Benefit stated at age must be 62 to 70 — it wasn't saved.",
      "Claim age (+ months) must be 0 to 11 — it wasn't saved.",
    ]);
  });

  it("a person with no Social Security row on the plan is blocked — rows are seeded, never made here", () => {
    const [draft] = place(SS_MAP, [rowOf("ss:Co-client", { monthlyBenefit: 1500 })], hendricksBook({ income: [markSs] }));
    expect(draft.recordId).toBeNull();
    expect(draft.blocked).toEqual({ reason: "This plan has no Social Security row for Laura Hendricks — add it in Details." });
  });

  it("a Co-client row on a household with no co-client is blocked", () => {
    const [draft] = place(SS_MAP, [rowOf("ss:Co-client", { monthlyBenefit: 1500 })], bookWith({}));
    expect(draft.blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: CO_CLIENT_CELL });
  });

  it("the link never names another record: one not in the book, or another income, falls back to the person's own row", () => {
    const book = hendricksBook({ income: [markSs, markSalary] });
    for (const recordId of ["ss-of-another-client", "sal-1"]) {
      const row = rowOf("ss:Client", { monthlyBenefit: 3200 }, { link: linkedTo(recordId) });
      expect(place(SS_MAP, [row], book)[0].recordId).toBe("ss-1");
    }
  });
});

describe("INCOME_MAP", () => {
  const from = (columnId: string) => [cell("income", "i1", columnId)];

  it("a filled row is a new income with every column", () => {
    const row = rowOf("i1", {
      incomeName: "Acme pension", type: "Deferred comp", owner: "Client", annualAmount: 24000, annualIncrease: 2,
      startYear: 2030, endYear: 2055, taxType: "Ordinary income", paidInMonth: "March", survivorContinues: 50,
    });
    expect(place(INCOME_MAP, [row], hendricksBook())).toEqual([
      {
        lineId: "i1/income", sectionId: "income", rowId: "i1", target: "income", recordId: null, label: "Acme pension",
        fields: [
          { key: "name", value: "Acme pension", from: from("incomeName") },
          { key: "type", value: "deferred", from: from("type") },
          { key: "owner", value: "client", from: from("owner") },
          { key: "annualAmount", value: 24000, from: from("annualAmount") },
          { key: "growthRate", value: 0.02, from: from("annualIncrease"), with: { growthSource: "custom" } },
          { key: "start", value: 2030, from: from("startYear") },
          { key: "end", value: 2055, from: from("endYear") },
          { key: "taxType", value: "ordinary_income", from: from("taxType") },
          { key: "paymentMonth", value: 3, from: from("paidInMonth") },
          { key: "survivorshipPct", value: 0.5, from: from("survivorContinues") },
        ],
        warnings: [],
      },
    ]);
  });

  it("a new income with no years starts this year and runs to the plan's end, growing with inflation", () => {
    const [draft] = place(INCOME_MAP, [rowOf("i1", { incomeName: "Rental income", type: "Other", annualAmount: 18000 })], hendricksBook());
    expect(draft.fixed).toEqual({ growthSource: "inflation" });
    expect(draft.fields.slice(3)).toEqual([
      { key: "start", value: 2026, from: [] },
      { key: "end", value: { yearRef: "plan_end" }, from: [] },
    ]);
  });

  it("a Start or End year that didn't read gets no default", () => {
    const row = rowOf("i1", { incomeName: "Rental income", type: "Other", annualAmount: 18000 });
    const [draft] = place(INCOME_MAP, [row], hendricksBook(), {}, ["i1:startYear", "i1:endYear"]);
    expect(draft.fields.map((f) => f.key)).toEqual(["name", "type", "annualAmount"]);
  });

  it("an Annual increase % that didn't read: the new income grows with inflation, and the line says so", () => {
    const row = rowOf("i1", { incomeName: "Rental income", type: "Other", annualAmount: 18000 });
    const [draft] = place(INCOME_MAP, [row], hendricksBook(), {}, ["i1:annualIncrease"]);
    expect(draft.fixed).toEqual({ growthSource: "inflation" });
    expect(draft.warnings).toEqual(['"Annual increase %" didn\'t read — this income grows with inflation until you set it.']);
  });

  it("an income on record: only the filled cells, no default years", () => {
    const row = rowOf("i1", { incomeName: null, annualAmount: 26000, startYear: null }, { link: linkedTo("inc-1") });
    const [draft] = place(INCOME_MAP, [row], hendricksBook({ income: [pension] }));
    expect(draft).toMatchObject({ recordId: "inc-1", label: "Acme pension", fields: [{ key: "annualAmount", value: 26000 }] });
    expect(draft.fixed).toBeUndefined();
  });

  it("a link to a record not in the book, or to a salary or Social Security row, never updates it", () => {
    const book = hendricksBook({ income: [pension, markSalary, markSs] });
    for (const recordId of ["inc-of-another-client", "sal-1", "ss-1"]) {
      const row = rowOf("i1", { incomeName: "Acme pension", annualAmount: 26000 }, { link: linkedTo(recordId) });
      expect(place(INCOME_MAP, [row], book)[0].recordId).toBeNull();
    }
  });

  it("Survivor % applies only to deferred comp owned by one person — the type and owner on record count", () => {
    const warning = "Survivor % applies only to deferred comp owned by one person.";
    const drafts = place(
      INCOME_MAP,
      [
        rowOf("i1", { incomeName: "Pension", type: "Other", owner: "Client", survivorContinues: 50 }),
        rowOf("i2", { incomeName: "Deferred comp", type: "Deferred comp", owner: "Joint", survivorContinues: 50 }),
        rowOf("i3", { survivorContinues: 75 }, { link: linkedTo("inc-1") }),
      ],
      hendricksBook({ income: [pension] }),
    );
    expect(drafts.map((d) => d.warnings)).toEqual([[warning], [warning], []]);
    expect(drafts.map((d) => d.fields.some((f) => f.key === "survivorshipPct"))).toEqual([false, false, true]);
  });

  it("a co-client or joint owner on a household with no co-client is blocked on the Owner cell", () => {
    const drafts = place(
      INCOME_MAP,
      [rowOf("i1", { incomeName: "Consulting", owner: "Co-client" }), rowOf("i2", { incomeName: "Rental", owner: "Joint" })],
      bookWith({}),
    );
    expect(drafts.map((d) => d.blocked)).toEqual([
      { reason: NO_CO_CLIENT_REASON, cell: cell("income", "i1", "owner") },
      { reason: NO_CO_CLIENT_REASON, cell: cell("income", "i2", "owner") },
    ]);
  });
});
