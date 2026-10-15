// src/lib/fact-finder/save/__tests__/plan.test.ts
import { describe, expect, it } from "vitest";
import {
  defaultTicks, TARGET_KINDS, type ChangeLine, type ChangeSet, type ChangeTicks, type PlacedValue, type RecordRef, type TargetKind,
} from "../../change-set";
import { buildChangeSet } from "../../placement/build";
import { bookWith, recordOf, rowOf, stateWith } from "../../placement/__tests__/fixtures";
import { planSave, TARGET_ORDER, type SavePlan } from "../plan";

const NOW = new Date("2026-03-15T12:00:00Z");
const MISMATCH = { ok: false, error: "The ticks don't match this change list — review again." };
const SINGLE = { hasCoClient: false };

/** A change line as the review makes one: each field ticked unless `unticked` names it. */
function lineOf(
  id: string,
  target: TargetKind,
  fields: Record<string, PlacedValue>,
  extra: Partial<ChangeLine> & { unticked?: string[] } = {},
): ChangeLine {
  const { unticked = [], ...rest } = extra;
  return {
    id, page: "accounts", sectionId: "cash", rowId: id.split("/")[0], target, action: "create", recordId: null, label: id,
    fields: Object.entries(fields).map(([key, next]) => ({ key, label: key, next, shown: { next: String(next) }, ticked: !unticked.includes(key), from: [] })),
    warnings: [],
    ...rest,
  };
}
const changeSetOf = (lines: ChangeLine[]): ChangeSet => ({ builtAtVersion: 4, builtAt: NOW.toISOString(), lines, notices: [] });
const lineRef = (target: TargetKind, lineId: string): RecordRef => ({ ref: "line", target, lineId });
const client: RecordRef = { ref: "person", role: "client" };

/** The review's default ticks with `off` (lineId → field keys) unticked. */
function ticksOf(changeSet: ChangeSet, off: Record<string, string[]> = {}): ChangeTicks {
  const ticks = defaultTicks(changeSet);
  for (const [lineId, keys] of Object.entries(off)) for (const key of keys) ticks[lineId][key] = false;
  return ticks;
}
const savedIds = (plan: SavePlan) => (plan.ok ? plan.lines.map((p) => p.line.id) : plan);
const leftOutOf = (plan: SavePlan) => (plan.ok ? plan.leftOut.map((l) => [l.lineId, l.reason]) : plan);

// A trust made in the save, the account it owns, that account's beneficiaries and the savings into it.
const trust = lineOf("t1/entity", "entity", { name: "Hendricks Family Trust", grantor: "client" }, {
  page: "estate", sectionId: "trusts", label: "Hendricks Family Trust", fixed: { entityType: "trust", isIrrevocable: true },
});
const trustChecking = lineOf("cash3/account", "account", { name: "Trust Checking", value: 2000, owners: [{ who: lineRef("entity", "t1/entity"), percent: 1 }] }, {
  label: "Trust Checking", fixed: { category: "cash" }, dependsOn: ["t1/entity"],
});
const beneficiaries = lineOf("cash3/account_beneficiary_designation", "account_beneficiary_designation", {
  beneficiaries: [{ tier: "primary", who: client, percentage: 100 }],
}, { label: "Trust Checking — beneficiaries", parent: lineRef("account", "cash3/account"), dependsOn: ["cash3/account"] });
const savings = lineOf("sv1/savings_rule", "savings_rule", { accountId: lineRef("account", "cash3/account"), annualAmount: 6000 }, {
  page: "expensesSavings", sectionId: "savings", label: "Savings — Trust Checking", dependsOn: ["cash3/account"],
});
// An account on record: its name starts unticked (D8), so the save leaves the name on record alone.
const ira = lineOf("r1/account", "account", { name: "Mark's Rollover IRA", value: 50000 }, {
  sectionId: "retirement", label: "Mark's IRA", action: "update", recordId: "a-1", unticked: ["name"],
});
const blocked = lineOf("liab1/liability", "liability", { balance: 9000 }, { page: "realEstateDebts", sectionId: "liab", label: "Car loan", blocked: { reason: "Pick who owns it." } });
const unchanged = lineOf("cash9/account", "account", {}, { label: "Old Checking", action: "none", recordId: "a-9" });

const lines = changeSetOf([trustChecking, beneficiaries, savings, ira, blocked, unchanged, trust]);

describe("TARGET_ORDER", () => {
  it("ranks every target once", () => {
    expect(TARGET_ORDER).toHaveLength(TARGET_KINDS.length);
    expect([...TARGET_ORDER].sort()).toEqual([...TARGET_KINDS].sort());
  });
});

describe("planSave — the ticks", () => {
  const good = ticksOf(lines);
  const without = (lineId: string) => Object.fromEntries(Object.entries(good).filter(([id]) => id !== lineId));
  const withLine = (lineId: string, line: unknown) => ({ ...good, [lineId]: line });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["not an object", "all"],
    ["a list", [good]],
    ["a line missing", without("sv1/savings_rule")],
    ["a line the change list doesn't have", withLine("cash4/account", { name: true })],
    ["a line that can't save", withLine("liab1/liability", { balance: true })],
    ["an unchanged line", withLine("cash9/account", {})],
    ["a line's ticks not an object", withLine("r1/account", true)],
    ["a field missing", withLine("r1/account", { value: true })],
    ["a field the line doesn't have", withLine("r1/account", { name: false, value: true, custodian: true })],
    ["a tick that isn't true or false", withLine("r1/account", { name: false, value: "yes" })],
  ])("%s → refused", (_case, ticks) => {
    expect(planSave(lines, ticks, SINGLE)).toEqual(MISMATCH);
  });

  it("the review's default ticks: every line that can save is saved, with what it writes", () => {
    const plan = planSave(lines, good, SINGLE);
    expect(plan.ok && plan.leftOut).toEqual([]);
    expect(plan.ok && plan.lines.map((p) => [p.line.id, p.values])).toEqual([
      ["t1/entity", { entityType: "trust", isIrrevocable: true, name: "Hendricks Family Trust", grantor: "client" }],
      ["cash3/account", { category: "cash", name: "Trust Checking", value: 2000, owners: [{ who: lineRef("entity", "t1/entity"), percent: 1 }] }],
      ["r1/account", { value: 50000 }],
      ["sv1/savings_rule", { accountId: lineRef("account", "cash3/account"), annualAmount: 6000 }],
      ["cash3/account_beneficiary_designation", { beneficiaries: [{ tier: "primary", who: client, percentage: 100 }] }],
    ]);
  });

  it("each saved line carries the advisor's ticks: an unticked name on an update isn't written; ticked, it is", () => {
    const left = planSave(lines, good, SINGLE);
    expect(left.ok && left.lines.find((p) => p.line.id === "r1/account")?.line.fields.map((f) => [f.key, f.ticked])).toEqual([["name", false], ["value", true]]);
    const named = planSave(lines, withLine("r1/account", { name: true, value: false }), SINGLE);
    const ira = named.ok ? named.lines.find((p) => p.line.id === "r1/account") : undefined;
    expect(ira?.values).toEqual({ name: "Mark's Rollover IRA" });
    expect(ira?.line.fields.map((f) => [f.key, f.ticked])).toEqual([["name", true], ["value", false]]);
    // The rest of the line is the change list's own.
    expect(ira?.line).toEqual({ ...lines.lines[3], fields: lines.lines[3].fields.map((f) => ({ ...f, ticked: f.key === "name" })) });
  });
});

describe("planSave — lines left out", () => {
  it("a line with nothing ticked is left out", () => {
    const plan = planSave(lines, ticksOf(lines, { "r1/account": ["value"] }), SINGLE);
    expect(leftOutOf(plan)).toEqual([["r1/account", "Nothing ticked."]]);
    expect(savedIds(plan)).not.toContain("r1/account");
  });

  it("a Create left out leaves out every line that needs it — by a reference it writes or by the record it hangs off — on down the chain", () => {
    const plan = planSave(lines, ticksOf(lines, { "t1/entity": ["name", "grantor"] }), SINGLE);
    expect(plan.ok && plan.leftOut).toEqual([
      { lineId: "cash3/account", rowId: "cash3", label: "Trust Checking", reason: "Needs “Hendricks Family Trust”, which isn't being saved." },
      { lineId: "cash3/account_beneficiary_designation", rowId: "cash3", label: "Trust Checking — beneficiaries", reason: "Needs “Trust Checking”, which isn't being saved." },
      { lineId: "sv1/savings_rule", rowId: "sv1", label: "Savings — Trust Checking", reason: "Needs “Trust Checking”, which isn't being saved." },
      { lineId: "t1/entity", rowId: "t1", label: "Hendricks Family Trust", reason: "Nothing ticked." },
    ]);
    expect(savedIds(plan)).toEqual(["r1/account"]);
  });

  it("a line referring to a line the change list doesn't have is left out (the review blocks it first)", () => {
    const set = changeSetOf([lineOf("cash5/account", "account", { owners: [{ who: lineRef("entity", "t9/entity"), percent: 1 }] }, { dependsOn: ["t9/entity"] })]);
    expect(leftOutOf(planSave(set, ticksOf(set), SINGLE))).toEqual([["cash5/account", "Needs “another row”, which isn't being saved."]]);
  });

  it("a reference only in an unticked field needs nothing: the save doesn't write it", () => {
    const owned = changeSetOf([trust, lineOf("r2/account", "account", { value: 1000, owners: [{ who: lineRef("entity", "t1/entity"), percent: 1 }] }, {
      action: "update", recordId: "a-2", label: "Brokerage", dependsOn: ["t1/entity"], unticked: ["owners"],
    })]);
    const plan = planSave(owned, ticksOf(owned, { "t1/entity": ["name", "grantor"] }), SINGLE);
    expect(savedIds(plan)).toEqual(["r2/account"]);
    expect(plan.ok && plan.lines[0].values).toEqual({ value: 1000 });
  });
});

describe("planSave — save order", () => {
  it("by target rank (D8); within a rank, change-set order", () => {
    const household = (row: string, key: string) => lineOf(`${row}/client_household`, "client_household", { [key]: "x" }, { action: "update", recordId: "c1" });
    const set = changeSetOf([
      lineOf("n1/plan_observation", "plan_observation", { body: "Note" }),
      lineOf("i1/income", "income", { annualAmount: 1 }),
      household("salary:Client", "employer"),
      lineOf("f1/family_member", "family_member", { firstName: "Ava" }),
      household("people:Client", "firstName"),
      lineOf("x1/external_beneficiary", "external_beneficiary", { name: "Red Cross" }),
      household("household:Household", "city"),
    ]);
    expect(savedIds(planSave(set, ticksOf(set), SINGLE))).toEqual([
      "salary:Client/client_household", "people:Client/client_household", "household:Household/client_household",
      "f1/family_member", "x1/external_beneficiary", "i1/income", "n1/plan_observation",
    ]);
  });

  it("a line that needs a later-ranked line moves after it — and so do the lines that need it", () => {
    const set = changeSetOf([
      lineOf("a1/account", "account", { name: "529" }),
      lineOf("f1/family_member", "family_member", { firstName: "Ava", notes: lineRef("account", "a1/account") }, { dependsOn: ["a1/account"] }),
      lineOf("x1/external_beneficiary", "external_beneficiary", { name: "Red Cross", notes: lineRef("family_member", "f1/family_member") }, { dependsOn: ["f1/family_member"] }),
      lineOf("e1/entity", "entity", { name: "Trust" }),
    ]);
    expect(savedIds(planSave(set, ticksOf(set), SINGLE))).toEqual(["e1/entity", "a1/account", "f1/family_member", "x1/external_beneficiary"]);
  });

  it("lines that need each other still all come back, in rank order (the save can't resolve them and refuses)", () => {
    const set = changeSetOf([
      lineOf("a1/account", "account", { name: "A", notes: lineRef("family_member", "f1/family_member") }, { dependsOn: ["f1/family_member"] }),
      lineOf("f1/family_member", "family_member", { firstName: "Ava", notes: lineRef("account", "a1/account") }, { dependsOn: ["a1/account"] }),
    ]);
    expect(savedIds(planSave(set, ticksOf(set), SINGLE))).toEqual(["f1/family_member", "a1/account"]);
  });

  it("keeps each line's field order, and its with values after their field", () => {
    const set = changeSetOf([lineOf("i1/income", "income", { growthRate: 0.04, annualAmount: 90000, start: 2026 }, { fixed: { type: "salary" } })]);
    set.lines[0].fields[0].with = { growthSource: "custom" };
    const plan = planSave(set, ticksOf(set), SINGLE);
    expect(plan.ok && plan.lines[0].line.fields.map((f) => f.key)).toEqual(["growthRate", "annualAmount", "start"]);
    expect(plan.ok && Object.keys(plan.lines[0].values)).toEqual(["type", "growthSource", "growthRate", "annualAmount", "start"]);
  });
});

/**
 * Mark's plan has no co-client; the fact finder adds Laura (the Co-client row's first name) and names her
 * every way a line can: a joint owner, a salary's owner and its end at her retirement, her employer, her
 * workplace plan, her will, a trust she's grantor of — and the account that trust owns.
 */
describe("planSave — a co-client the fact finder adds", () => {
  const mark = bookWith(
    {
      client_household: [recordOf("c1", "Mark Hendricks", { firstName: "Mark", lastName: "Hendricks" })],
      plan_settings_tax_rates: [recordOf("ps-1", "Tax settings", {})],
    },
    { people: { client: "fm-client", spouse: null }, names: { client: "Mark", spouse: null } },
  );
  const state = stateWith({
    people: [
      rowOf("people:Client", {}),
      rowOf("people:Co-client", { firstName: "Laura", lastName: "Hendricks", dateOfBirth: "1970-09-30", coveredByWorkplacePlan: "Yes" }),
    ],
    salary: [rowOf("salary:Client", {}), rowOf("salary:Co-client", { employer: "Acme", annualSalary: 80000 })],
    cash: [
      rowOf("cash1", { accountName: "Joint Checking", currentValue: 5000, owner: "Joint", accountType: "Checking" }),
      rowOf("cash2", { accountName: "Mark's Savings", currentValue: 9000, owner: "Client", accountType: "Savings" }),
      rowOf("cash3", { accountName: "Trust Checking", currentValue: 2000, owner: "Trust / entity", ownerEntity: "Hendricks Family Trust", accountType: "Checking" }),
    ],
    trusts: [rowOf("t1", { trustName: "Hendricks Family Trust", trustType: "ILIT", grantor: "Co-client" })],
    estate_docs: [rowOf("estate_docs:Client", {}), rowOf("estate_docs:Co-client", { will: true })],
  });
  const review = async (): Promise<ChangeSet> => ({ builtAtVersion: 4, ...(await buildChangeSet({ state, book: mark, now: NOW, runLeftovers: async () => null })) });
  const NEEDS_CO_CLIENT = "Needs the co-client, who isn't being saved.";
  const NOTHING_TICKED = "Nothing ticked.";

  it("the review's change list: Laura is added by the Co-client line, and nothing is blocked", async () => {
    const changeSet = await review();
    expect(changeSet.lines.map((l) => [l.id, l.action, l.blocked?.reason])).toEqual([
      ["people:Co-client/client_household", "update", undefined],
      ["people:Co-client/plan_settings_tax_rates", "update", undefined],
      ["cash1/account", "create", undefined],
      ["cash2/account", "create", undefined],
      ["cash3/account", "create", undefined],
      ["salary:Co-client/client_household", "update", undefined],
      ["salary:Co-client/income", "create", undefined],
      ["estate_docs:Co-client/will", "create", undefined],
      ["t1/entity", "create", undefined],
    ]);
  });

  it("with her first name ticked, everything saves — the household lines first, the trust before the account it owns", async () => {
    const changeSet = await review();
    const plan = planSave(changeSet, ticksOf(changeSet), SINGLE);
    expect(plan.ok && plan.leftOut).toEqual([]);
    expect(savedIds(plan)).toEqual([
      "people:Co-client/client_household", "salary:Co-client/client_household", "people:Co-client/plan_settings_tax_rates",
      "t1/entity", "cash1/account", "cash2/account", "cash3/account", "salary:Co-client/income", "estate_docs:Co-client/will",
    ]);
  });

  /** Everything after the Co-client line, left out: each line naming her, and the account her trust owns. */
  const namingHer = [
    ["people:Co-client/plan_settings_tax_rates", NEEDS_CO_CLIENT],
    ["cash1/account", NEEDS_CO_CLIENT],
    ["cash3/account", "Needs “Hendricks Family Trust”, which isn't being saved."],
    ["salary:Co-client/client_household", NEEDS_CO_CLIENT],
    ["salary:Co-client/income", NEEDS_CO_CLIENT],
    ["estate_docs:Co-client/will", NEEDS_CO_CLIENT],
    ["t1/entity", NEEDS_CO_CLIENT],
  ];

  it("with her first name unticked, every line that names her is left out — her other fields' line too — and what needs those lines", async () => {
    const changeSet = await review();
    const plan = planSave(changeSet, ticksOf(changeSet, { "people:Co-client/client_household": ["spouseName"] }), SINGLE);
    expect(leftOutOf(plan)).toEqual([["people:Co-client/client_household", NEEDS_CO_CLIENT], ...namingHer]);
    expect(savedIds(plan)).toEqual(["cash2/account"]);
  });

  it("with the Co-client line wholly unticked, it has nothing ticked and the lines naming her are left out", async () => {
    const changeSet = await review();
    const plan = planSave(changeSet, ticksOf(changeSet, { "people:Co-client/client_household": ["spouseName", "spouseLastName", "spouseDob"] }), SINGLE);
    expect(leftOutOf(plan)).toEqual([["people:Co-client/client_household", NOTHING_TICKED], ...namingHer]);
    expect(savedIds(plan)).toEqual(["cash2/account"]);
  });

  it.each<[string, TargetKind, Record<string, PlacedValue>]>([
    ["a life policy owned jointly", "life_insurance_policy", { ownerRef: "joint" }],
    ["a survivorship policy", "life_insurance_policy", { insuredPerson: "joint" }],
    ["premiums paid by both", "life_insurance_policy", { premiumPayer: "both" }],
    ["her disability policy", "disability_policy", { insured: "spouse" }],
    ["a split gift", "gift", { grantor: "joint" }],
    ["a trust that ends at her death", "entity", { trustEnds: "spouse_death" }],
    ["her as a beneficiary", "account_beneficiary_designation", { beneficiaries: [{ tier: "contingent", who: { ref: "person", role: "spouse" }, percentage: 100 }] }],
    ["savings until her retirement", "savings_rule", { end: { yearRef: "spouse_retirement" } }],
  ])("names her: %s", (_case, target, fields) => {
    const set = changeSetOf([lineOf(`x1/${target}`, target, fields)]);
    expect(leftOutOf(planSave(set, ticksOf(set), SINGLE))).toEqual([[`x1/${target}`, NEEDS_CO_CLIENT]]);
  });

  it("doesn't name her: the client, or a name that only reads like a role", () => {
    const set = changeSetOf([
      lineOf("x1/account", "account", { name: "Joint", owners: [{ who: client, percent: 1 }] }),
      lineOf("x2/will", "will", { grantor: "client" }),
      lineOf("x3/income", "income", { end: { yearRef: "client_retirement" } }),
    ]);
    expect(savedIds(planSave(set, ticksOf(set), SINGLE))).toEqual(["x1/account", "x3/income", "x2/will"]);
  });

  it("on a plan that has the co-client, unticking her first name leaves nothing out", async () => {
    const changeSet = await review();
    const plan = planSave(changeSet, ticksOf(changeSet, { "people:Co-client/client_household": ["spouseName"] }), { hasCoClient: true });
    expect(plan.ok && plan.leftOut).toEqual([]);
    expect(plan.ok && plan.lines).toHaveLength(9);
  });
});
