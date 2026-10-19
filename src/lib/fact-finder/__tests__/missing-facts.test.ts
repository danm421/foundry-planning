import { describe, it, expect } from "vitest";
import { FACT_FINDER_STEP_IDS } from "@/domain/mcp/fact-finder-steps";
import type { TargetKind } from "../change-set";
import { missingFacts, missingFactsByStep } from "../missing-facts";
import { emptyRecordBook, type BookRecord, type RecordBook } from "../placement/types";

const YEAR = 2026;
const client = { ref: "person", role: "client" } as const;

function bookWith(records: Partial<Record<TargetKind, BookRecord[]>>): RecordBook {
  const b = emptyRecordBook("c1");
  return {
    ...b,
    scenarioId: "s1",
    people: { client: "fm-c", spouse: "fm-s" },
    names: { client: "Alex", spouse: "Sam" },
    records: { ...b.records, ...records },
  };
}

const household = (values: Record<string, unknown> = {}): BookRecord => ({
  id: "c1",
  label: "Alex Rivera",
  values: {
    dateOfBirth: "1990-05-01",
    retirementAge: 65,
    spouseName: "Sam",
    spouseDob: "1991-02-03",
    spouseRetirementAge: 65,
    ...values,
  } as BookRecord["values"],
});
const living = (annualAmount: number): BookRecord => ({
  id: "liv",
  label: "Living",
  values: { annualAmount },
  facts: { type: "living" },
});
const salary = (owner: string): BookRecord => ({
  id: `sal-${owner}`,
  label: "Salary",
  values: { type: "salary", owner },
  facts: { type: "salary", owner },
});

/** Everything a plan needs: both people working with salaries, living costs on record. */
function complete(): Partial<Record<TargetKind, BookRecord[]>> {
  return { client_household: [household()], income: [salary("client"), salary("spouse")], expense: [living(80000)] };
}

const forStep = (b: RecordBook, step: string) => missingFacts(b, { currentYear: YEAR }).filter((m) => m.step === step);

describe("missingFacts", () => {
  it("returns nothing for a complete household", () => {
    expect(missingFacts(bookWith(complete()), { currentYear: YEAR })).toEqual([]);
  });

  it("asks for the date of birth of the client and the second person, by name", () => {
    const b = bookWith({ ...complete(), client_household: [household({ dateOfBirth: null, spouseDob: null })] });
    const found = forStep(b, "household");
    expect(found.map((m) => m.label)).toEqual(["Alex", "Sam"]);
    expect(found.every((m) => m.missing === "date of birth" && m.target === "client_household" && m.recordId === "c1")).toBe(true);
  });

  it("does not ask for a date of birth of a second person who isn't on record", () => {
    const b = bookWith({
      ...complete(),
      client_household: [household({ spouseName: null, spouseDob: null })],
      income: [salary("client")],
    });
    b.people.spouse = null;
    expect(forStep(b, "household")).toEqual([]);
  });

  it("asks for a family member's date of birth", () => {
    const b = bookWith({ ...complete(), family_member: [{ id: "fm1", label: "Jo Rivera", values: { dateOfBirth: null } }] });
    expect(forStep(b, "household")).toEqual([
      { step: "household", target: "family_member", recordId: "fm1", label: "Jo Rivera", missing: "date of birth" },
    ]);
  });

  it("asks for the property tax on real estate", () => {
    const home = (tax: number): BookRecord => ({ id: "re1", label: "Home", values: { annualPropertyTax: tax }, facts: { category: "real_estate" } });
    expect(forStep(bookWith({ ...complete(), account: [home(0)] }), "real_estate")).toEqual([
      { step: "real_estate", target: "account", recordId: "re1", label: "Home", missing: "annual property tax" },
    ]);
    expect(forStep(bookWith({ ...complete(), account: [home(6000)] }), "real_estate")).toEqual([]);
  });

  it("asks which property a mortgage or HELOC is on", () => {
    const debt = (liabilityType: string, linked: unknown): BookRecord => ({
      id: `l-${liabilityType}`,
      label: liabilityType,
      values: { liabilityType, linkedPropertyId: linked as BookRecord["values"][string] },
    });
    const linked = { ref: "record", target: "account", id: "re1" };
    const b = bookWith({
      ...complete(),
      liability: [debt("mortgage", null), debt("heloc", null), debt("auto", null), { ...debt("mortgage", linked), id: "l-ok" }],
    });
    expect(forStep(b, "balance_sheet").map((m) => [m.recordId, m.missing])).toEqual([
      ["l-mortgage", "the property it's on"],
      ["l-heloc", "the property it's on"],
    ]);
  });

  it("asks for a salary from a working person who has none, but not once they are past retirement age", () => {
    const b = bookWith({ ...complete(), income: [salary("client")] });
    expect(forStep(b, "income")).toEqual([
      { step: "income", target: "client_household", recordId: "c1", label: "Sam", missing: "a salary, or confirmation there is none" },
    ]);
    const retired = bookWith({ ...complete(), client_household: [household({ dateOfBirth: "1950-01-01" })], income: [salary("spouse")] });
    expect(forStep(retired, "income")).toEqual([]);
  });

  it("counts a joint salary for both people", () => {
    expect(forStep(bookWith({ ...complete(), income: [salary("joint")] }), "income")).toEqual([]);
  });

  it("asks for a benefit estimate on Social Security income with no PIA", () => {
    const ss = (piaMonthly: number | null): BookRecord => ({
      id: "ss1",
      label: "Alex Social Security",
      values: { type: "social_security", piaMonthly },
      facts: { type: "social_security" },
    });
    const missing = (pia: number | null) => forStep(bookWith({ ...complete(), income: [...complete().income!, ss(pia)] }), "income");
    expect(missing(null)).toEqual([{ step: "income", target: "income", recordId: "ss1", label: "Alex Social Security", missing: "a benefit estimate" }]);
    expect(missing(0)).toHaveLength(1);
    expect(missing(2400)).toEqual([]);
  });

  it("asks for contributions to a retirement account whose owner is still working", () => {
    const ira = (owner: unknown): BookRecord => ({
      id: "ira1",
      label: "Schwab IRA",
      values: { owners: [{ who: owner, percent: 1 }] as BookRecord["values"][string] },
      facts: { category: "retirement" },
    });
    const rule: BookRecord = { id: "r1", label: "IRA", values: {}, facts: { accountId: "ira1" } };
    expect(forStep(bookWith({ ...complete(), account: [ira(client)] }), "savings")).toEqual([
      { step: "savings", target: "account", recordId: "ira1", label: "Schwab IRA", missing: "contributions, or confirmation there are none" },
    ]);
    expect(forStep(bookWith({ ...complete(), account: [ira(client)], savings_rule: [rule] }), "savings")).toEqual([]);
    const retired = bookWith({ ...complete(), client_household: [household({ dateOfBirth: "1950-01-01" })], account: [ira(client)] });
    expect(forStep(retired, "savings")).toEqual([]);
  });

  it("asks for the amount and timing of a goal", () => {
    const goal = (id: string, annualAmount: number | null, start: number | null): BookRecord => ({
      id,
      label: id,
      values: { isGoal: true, annualAmount, start },
    });
    const b = bookWith({
      ...complete(),
      expense: [living(80000), goal("g-none", null, 2030), goal("g-nostart", 20000, null), goal("g-ok", 20000, 2030)],
    });
    expect(forStep(b, "goals").map((m) => [m.recordId, m.missing])).toEqual([
      ["g-none", "amount and timing"],
      ["g-nostart", "amount and timing"],
    ]);
  });

  it("asks for living expenses when there are none or every one is $0", () => {
    const none = forStep(bookWith({ ...complete(), expense: [] }), "living_expenses");
    expect(none).toEqual([{ step: "living_expenses", target: "expense", recordId: null, label: "Living expenses", missing: "current living expenses" }]);
    expect(forStep(bookWith({ ...complete(), expense: [living(0)] }), "living_expenses")).toHaveLength(1);
    expect(forStep(bookWith({ ...complete(), expense: [living(0), { ...living(5000), id: "l2" }] }), "living_expenses")).toEqual([]);
  });

  it("asks for a life policy's death benefit and owner", () => {
    const policy = (faceValue: number | null, ownerRef: unknown): BookRecord => ({
      id: "p1",
      label: "Term 20",
      values: { faceValue, ownerRef: ownerRef as BookRecord["values"][string] },
    });
    const found = (p: BookRecord) => forStep(bookWith({ ...complete(), life_insurance_policy: [p] }), "insurance").map((m) => m.missing);
    expect(found(policy(null, null))).toEqual(["death benefit", "owner"]);
    expect(found(policy(500000, null))).toEqual(["owner"]);
    expect(found(policy(null, "joint"))).toEqual(["death benefit"]);
    expect(found(policy(500000, "joint"))).toEqual([]);
  });

  it("asks who inherits under a will with no bequest and no remaining-estate recipient", () => {
    const will: BookRecord = { id: "w1", label: "Alex's will", values: { grantor: "client" }, facts: { grantor: "client" } };
    const residuary = (recipients: unknown[]): BookRecord => ({ id: "w1", label: "r", values: { recipients: recipients as BookRecord["values"][string] } });
    const bequest: BookRecord = { id: "b1", label: "Boat", values: {}, facts: { willId: "w1" } };
    const expected = [{ step: "estate", target: "will", recordId: "w1", label: "Alex's will", missing: "who inherits" }];
    expect(forStep(bookWith({ ...complete(), will: [will], will_residuary_recipient: [residuary([])] }), "estate")).toEqual(expected);
    expect(forStep(bookWith({ ...complete(), will: [will] }), "estate")).toEqual(expected);
    expect(forStep(bookWith({ ...complete(), will: [will], will_bequest: [bequest], will_residuary_recipient: [residuary([])] }), "estate")).toEqual([]);
    const named = residuary([{ who: client, percentage: 1 }]);
    expect(forStep(bookWith({ ...complete(), will: [will], will_residuary_recipient: [named] }), "estate")).toEqual([]);
  });

  it("counts every step across the household, 0 included", () => {
    const b = bookWith({
      ...complete(),
      expense: [],
      family_member: [{ id: "fm1", label: "Jo", values: { dateOfBirth: null } }],
    });
    const all = missingFacts(b, { currentYear: YEAR });
    expect(all.map((m) => m.step)).toEqual(["household", "living_expenses"]);
    const counts = missingFactsByStep(all);
    expect(Object.keys(counts).sort()).toEqual([...FACT_FINDER_STEP_IDS].sort());
    expect(counts.household).toBe(1);
    expect(counts.living_expenses).toBe(1);
    expect(counts.estate).toBe(0);
  });
});
