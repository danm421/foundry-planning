// src/lib/fact-finder/save/__tests__/plan.test.ts
import { describe, expect, it } from "vitest";
import {
  defaultTicks, TARGET_KINDS, type ChangeLine, type ChangeSet, type ChangeTicks, type PlacedValue, type RecordRef, type TargetKind,
} from "../../change-set";
import { buildChangeSet } from "../../placement/build";
import { bookWith, recordOf, rowOf, stateWith } from "../../placement/__tests__/fixtures";
import { planSave, TARGET_ORDER } from "../plan";

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
type SavePlan = ReturnType<typeof planSave>;
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

  it("a reference in what a Create is created with needs its line: a business's income, the business wholly unticked", () => {
    const business = lineOf("b1/business_account", "business_account", { name: "Acme LLC", value: 250000 }, {
      page: "realEstateDebts", sectionId: "business", label: "Acme LLC", fixed: { category: "business" }, unticked: ["name", "value"],
    });
    const income = lineOf("b1/income", "income", { annualAmount: 120000 }, {
      page: "realEstateDebts", sectionId: "business", label: "Acme LLC income",
      fixed: { type: "business", ownerAccountId: lineRef("business_account", "b1/business_account") }, dependsOn: ["b1/business_account"],
    });
    const set = changeSetOf([business, income]);
    expect(leftOutOf(planSave(set, ticksOf(set), SINGLE))).toEqual([
      ["b1/business_account", "Nothing ticked."],
      ["b1/income", "Needs “Acme LLC”, which isn't being saved."],
    ]);
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

/**
 * With a co-client, a new record's unticked Owner would be saved as the client's alone — the default the review
 * blocks for a blank Owner (helpers.ts ownersOf; the note, business and stock option maps block a blank one too).
 */
describe("planSave — who owns a new record", () => {
  const WITH_CO_CLIENT = { hasCoClient: true };
  const OWNER_UNTICKED = "Who owns it isn't ticked.";
  const coClient: RecordRef = { ref: "person", role: "spouse" };
  const joint: PlacedValue = [{ who: client, percent: 0.5 }, { who: coClient, percent: 0.5 }];
  const clientAlone: PlacedValue = [{ who: client, percent: 1 }];

  it.each<[TargetKind, string, PlacedValue]>([
    ["account", "owners", joint],
    ["liability", "owners", joint],
    ["life_insurance_policy", "ownerRef", "joint"],
    ["note_receivable", "owners", joint],
    ["business_account", "owners", joint],
    ["stock_option_account", "owner", "spouse"],
  ])("with a co-client, a new %s whose %s is unticked is left out — and so is what needs it", (target, key, owner) => {
    const set = changeSetOf([
      lineOf(`x1/${target}`, target, { name: "Lake fund", [key]: owner }, { label: "Lake fund", unticked: [key] }),
      lineOf("n1/plan_observation", "plan_observation", { body: "Note", notes: lineRef(target, `x1/${target}`) }, { dependsOn: [`x1/${target}`] }),
    ]);
    const plan = planSave(set, ticksOf(set), WITH_CO_CLIENT);
    expect(leftOutOf(plan)).toEqual([
      [`x1/${target}`, OWNER_UNTICKED],
      ["n1/plan_observation", "Needs “Lake fund”, which isn't being saved."],
    ]);
    expect(savedIds(plan)).toEqual([]);
    // Its owner ticked, it saves.
    const owned = { ...ticksOf(set), [`x1/${target}`]: { name: true, [key]: true } };
    expect(savedIds(planSave(set, owned, WITH_CO_CLIENT))).toEqual([`x1/${target}`, "n1/plan_observation"]);
  });

  it("unchanged: a single household's unticked owner (the client alone), an Update's (the record's stays), an income's (the review lets it be the client's)", () => {
    const single = changeSetOf([lineOf("x1/account", "account", { name: "Checking", owners: clientAlone }, { unticked: ["owners"] })]);
    expect(savedIds(planSave(single, ticksOf(single), SINGLE))).toEqual(["x1/account"]);
    const set = changeSetOf([
      lineOf("r1/account", "account", { value: 10, owners: joint }, { action: "update", recordId: "a-1", unticked: ["owners"] }),
      lineOf("i1/income", "income", { name: "Rental income", owner: "joint" }, { unticked: ["owner"] }),
    ]);
    const plan = planSave(set, ticksOf(set), WITH_CO_CLIENT);
    expect(plan.ok && plan.leftOut).toEqual([]);
    expect(plan.ok && plan.lines.map((p) => p.values)).toEqual([{ value: 10 }, { name: "Rental income" }]);
  });

  it("a line with nothing ticked says so first", () => {
    const set = changeSetOf([lineOf("x1/account", "account", { owners: joint }, { unticked: ["owners"] })]);
    expect(leftOutOf(planSave(set, ticksOf(set), WITH_CO_CLIENT))).toEqual([["x1/account", "Nothing ticked."]]);
  });

  // A new note, business, stock option account or life policy can't be saved without an owner on any household.
  it.each<[TargetKind, string, PlacedValue]>([
    ["note_receivable", "owners", clientAlone],
    ["business_account", "owners", clientAlone],
    ["stock_option_account", "owner", "client"],
    ["life_insurance_policy", "ownerRef", client],
  ])("on a single household too, a new %s whose %s is unticked is left out — and so is what needs it", (target, key, owner) => {
    const set = changeSetOf([
      lineOf(`x1/${target}`, target, { name: "Lake fund", [key]: owner }, { label: "Lake fund", unticked: [key] }),
      lineOf("n1/plan_observation", "plan_observation", { body: "Note", notes: lineRef(target, `x1/${target}`) }, { dependsOn: [`x1/${target}`] }),
      lineOf("c1/account", "account", { name: "Checking" }),
    ]);
    const plan = planSave(set, ticksOf(set), SINGLE);
    expect(leftOutOf(plan)).toEqual([
      [`x1/${target}`, OWNER_UNTICKED],
      ["n1/plan_observation", "Needs “Lake fund”, which isn't being saved."],
    ]);
    expect(savedIds(plan)).toEqual(["c1/account"]);
    // Its owner ticked, it saves.
    const owned = { ...ticksOf(set), [`x1/${target}`]: { name: true, [key]: true } };
    expect([...(savedIds(planSave(set, owned, SINGLE)) as string[])].sort()).toEqual(["c1/account", "n1/plan_observation", `x1/${target}`]);
  });

  it("on a single household, a new account's or loan's unticked Owner still saves (as the client's alone)", () => {
    const set = changeSetOf([
      lineOf("x1/account", "account", { name: "Checking", owners: clientAlone }, { unticked: ["owners"] }),
      lineOf("x2/liability", "liability", { name: "Car loan", balance: 9000, owners: clientAlone }, { unticked: ["owners"] }),
    ]);
    const plan = planSave(set, ticksOf(set), SINGLE);
    expect(plan.ok && plan.leftOut).toEqual([]);
    expect(plan.ok && plan.lines.map((p) => [p.line.id, p.values])).toEqual([
      ["x1/account", { name: "Checking" }],
      ["x2/liability", { name: "Car loan", balance: 9000 }],
    ]);
  });

  it("on a single household, an Owner ticked as the co-client still needs the co-client", () => {
    const set = changeSetOf([lineOf("x1/stock_option_account", "stock_option_account", { name: "Initech", owner: "spouse" })]);
    expect(leftOutOf(planSave(set, ticksOf(set), SINGLE))).toEqual([["x1/stock_option_account", "Needs the co-client, who isn't being saved."]]);
    expect(leftOutOf(planSave(set, ticksOf(set, { "x1/stock_option_account": ["owner"] }), SINGLE))).toEqual([["x1/stock_option_account", OWNER_UNTICKED]]);
  });
});

/** Mark alone on the plan; the fact finder adds one of each new record that has an Owner, each the client's. */
describe("planSave — a single household's new records, as the review builds them", () => {
  const mark = bookWith(
    { client_household: [recordOf("c1", "Mark Hendricks", { firstName: "Mark", lastName: "Hendricks" })] },
    { people: { client: "fm-client", spouse: null }, names: { client: "Mark", spouse: null } },
  );
  const state = stateWith({
    cash: [rowOf("cash1", { accountName: "Checking", currentValue: 5000, owner: "Client", accountType: "Checking" })],
    equity: [rowOf("eq1", {
      company: "Initech", owner: "Client", grantType: "NQSO", grantDate: "2024-01-15", sharesGranted: 1000, strikePrice: 10,
      expirationDate: "2034-01-15", vestingSchedule: "25% a year over 4 years",
    })],
    notes_rec: [rowOf("nr1", {
      borrower: "Nephew loan", originalAmount: 20000, interestRate: 0.04, paymentType: "Amortizing", monthlyPayment: 400, start: "2024-01", termMonths: 60, owner: "Client",
    })],
    business: [rowOf("b1", { businessName: "Acme LLC", businessType: "LLC", currentValue: 250000, costBasis: 50000, ownersAndPercent: "Mark 100%", annualIncome: 90000 })],
    liab: [rowOf("lb1", { loanName: "Car loan", type: "Auto loan", owner: "Client", balance: 9000, interestRate: 0.05, monthlyPI: 300, loanStart: "2024-01", termYears: 5 })],
    life: [rowOf("l1", { policyName: "Term Life", carrier: "MetLife", policyType: "Whole life", owner: "Client", insured: "Client", deathBenefit: 500000, primaryBeneficiary: "Mark" })],
  });
  const review = async (): Promise<ChangeSet> => ({ builtAtVersion: 4, ...(await buildChangeSet({ state, book: mark, now: NOW, runLeftovers: async () => null })) });
  const OWNER_UNTICKED = "Who owns it isn't ticked.";

  it("every Owner unticked: the note, business, stock option account and life policy are left out with what hangs off them; the account and loan save as the client's", async () => {
    const changeSet = await review();
    expect(changeSet.lines.map((l) => [l.id, l.action, l.blocked?.reason])).toEqual([
      ["cash1/account", "create", undefined],
      ["eq1/stock_option_account", "create", undefined],
      ["eq1/stock_option_grant", "create", undefined],
      ["nr1/note_receivable", "create", undefined],
      ["b1/business_account", "create", undefined],
      ["b1/income", "create", undefined],
      ["lb1/liability", "create", undefined],
      ["l1/life_insurance_policy", "create", undefined],
      ["l1/life_insurance_policy_beneficiary", "create", undefined],
    ]);
    const ticks = ticksOf(changeSet, {
      "cash1/account": ["owners"], "eq1/stock_option_account": ["owner"], "nr1/note_receivable": ["owners"],
      "b1/business_account": ["owners"], "lb1/liability": ["owners"], "l1/life_insurance_policy": ["ownerRef"],
    });
    const plan = planSave(changeSet, ticks, SINGLE);
    expect(leftOutOf(plan)).toEqual([
      ["eq1/stock_option_account", OWNER_UNTICKED],
      ["eq1/stock_option_grant", "Needs “Initech”, which isn't being saved."],
      ["nr1/note_receivable", OWNER_UNTICKED],
      ["b1/business_account", OWNER_UNTICKED],
      ["b1/income", "Needs “Acme LLC”, which isn't being saved."],
      ["l1/life_insurance_policy", OWNER_UNTICKED],
      ["l1/life_insurance_policy_beneficiary", "Needs “Term Life”, which isn't being saved."],
    ]);
    expect(savedIds(plan)).toEqual(["cash1/account", "lb1/liability"]);
    expect(plan.ok && plan.lines.map((p) => "owners" in p.values)).toEqual([false, false]);
    // The review's own ticks save all nine.
    expect(planSave(changeSet, ticksOf(changeSet), SINGLE)).toMatchObject({ ok: true, leftOut: [] });
  });
});

/**
 * Mark's group disability policy: "Short-term coverage? No — Long-term? Yes, 60% after 90 days". Unticked, a stated
 * coverage answer on a new policy would leave the create schema's Yes (with terms nobody stated), so the policy is
 * left out instead.
 */
describe("planSave — a new disability policy's coverage answers, as the review builds them", () => {
  const book = (extra: Parameters<typeof bookWith>[0] = {}) =>
    bookWith(
      { client_household: [recordOf("c1", "Mark Hendricks", { firstName: "Mark", lastName: "Hendricks" })], ...extra },
      { people: { client: "fm-client", spouse: null }, names: { client: "Mark", spouse: null } },
    );
  const ltd = { ltdWaitingDays: 90, ltdBenefitPercent: 60, benefitsRun: "To age", benefitsRunValue: 65 };
  const groupLtd = { policyName: "Group LTD", whoIsCovered: "Client", shortTerm: "No", longTerm: "Yes", ...ltd };
  const review = async (cells: Parameters<typeof rowOf>[1], onPlan = book(), link?: string): Promise<ChangeSet> => ({
    builtAtVersion: 4,
    ...(await buildChangeSet({
      state: stateWith({ disability: [rowOf("di1", cells, link ? { link: { kind: "existing", recordId: link, score: 1, confirmed: true, by: "advisor" } } : {})] }),
      book: onPlan,
      now: NOW,
      runLeftovers: async () => null,
    })),
  });

  it.each([
    { unticked: ["hasShortTerm"], reason: "Short-term coverage isn't ticked." },
    { unticked: ["hasLongTerm"], reason: "Long-term coverage isn't ticked." },
    { unticked: ["hasLongTerm", "hasShortTerm"], reason: "Short-term coverage isn't ticked." },
  ])("a stated answer unticked ($unticked) leaves the policy out, naming it", async ({ unticked, reason }) => {
    const changeSet = await review(groupLtd);
    const [policy] = changeSet.lines;
    expect([policy.id, policy.action, policy.blocked]).toEqual(["di1/disability_policy", "create", undefined]);
    expect(policy.fields.filter((f) => unticked.includes(f.key)).map((f) => f.label).sort()).toEqual(
      unticked.map((key) => (key === "hasShortTerm" ? "Short-term coverage" : "Long-term coverage")).sort(),
    );
    const plan = planSave(changeSet, ticksOf(changeSet, { "di1/disability_policy": unticked }), SINGLE);
    expect(leftOutOf(plan)).toEqual([["di1/disability_policy", reason]]);
    expect(savedIds(plan)).toEqual([]);
    // Ticked, it saves with the answers stated.
    const ticked = planSave(changeSet, ticksOf(changeSet), SINGLE);
    expect(ticked.ok && ticked.lines.map((p) => [p.line.id, p.values.hasShortTerm, p.values.hasLongTerm])).toEqual([["di1/disability_policy", false, true]]);
  });

  it("an inferred answer (no question answered, the coverage's own cells filled) is written with the policy: it saves with any field unticked", async () => {
    const changeSet = await review({ policyName: "Group LTD", whoIsCovered: "Client", ...ltd });
    const [policy] = changeSet.lines;
    expect(policy.fixed).toEqual({ hasShortTerm: false, hasLongTerm: true });
    expect(policy.fields.map((f) => f.key)).not.toContain("hasShortTerm");
    const plan = planSave(changeSet, ticksOf(changeSet, { "di1/disability_policy": ["ltdEliminationDays"] }), SINGLE);
    expect(savedIds(plan)).toEqual(["di1/disability_policy"]);
    expect(plan.ok && plan.lines[0].values).toMatchObject({ hasShortTerm: false, hasLongTerm: true });
  });

  it("an Update's unticked coverage answer leaves the policy's own as it is: the rest of the line saves", async () => {
    const onRecord = recordOf("dp-1", "Group LTD", {
      name: "Group LTD", insured: "client", hasShortTerm: true, hasLongTerm: true, ltdEliminationDays: 90, ltdBenefitPct: 0.5,
      ltdBenefitPeriodMode: "to_age", ltdBenefitPeriodAge: 65,
    });
    const changeSet = await review(groupLtd, book({ disability_policy: [onRecord] }), "dp-1");
    const [policy] = changeSet.lines;
    expect([policy.action, policy.fields.map((f) => f.key)]).toEqual(["update", ["hasShortTerm", "ltdBenefitPct"]]);
    const plan = planSave(changeSet, ticksOf(changeSet, { "di1/disability_policy": ["hasShortTerm"] }), SINGLE);
    expect(leftOutOf(plan)).toEqual([]);
    expect(plan.ok && plan.lines[0].values).toEqual({ ltdBenefitPct: 0.6 });
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

  it("when lines need each other, one of them goes first — never a line that only needs one of them", () => {
    const set = changeSetOf([
      lineOf("c1/family_member", "family_member", { firstName: "Cy", notes: lineRef("account", "a1/account") }, { dependsOn: ["a1/account"] }),
      lineOf("a1/account", "account", { name: "A", notes: lineRef("income", "b1/income") }, { dependsOn: ["b1/income"] }),
      lineOf("b1/income", "income", { name: "B", notes: lineRef("account", "a1/account") }, { dependsOn: ["a1/account"] }),
    ]);
    expect(savedIds(planSave(set, ticksOf(set), SINGLE))).toEqual(["a1/account", "c1/family_member", "b1/income"]);
  });

  it("keeps each line's field order, and its with values just before their field", () => {
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
    ["a provision only if she survives", "will_bequest", { kind: "asset", condition: "if_spouse_survives", percentage: 100 }],
    ["a provision only if she dies first", "will_bequest", { kind: "asset", condition: "if_spouse_predeceased", percentage: 100 }],
  ])("names her: %s", (_case, target, fields) => {
    const set = changeSetOf([lineOf(`x1/${target}`, target, fields)]);
    expect(leftOutOf(planSave(set, ticksOf(set), SINGLE))).toEqual([[`x1/${target}`, NEEDS_CO_CLIENT]]);
  });

  it("names her only in what it's created with: her salary, its End unticked", () => {
    const set = changeSetOf([
      lineOf("x1/income", "income", { annualAmount: 80000, end: { yearRef: "spouse_retirement" } }, { fixed: { type: "salary", owner: "spouse" }, unticked: ["end"] }),
    ]);
    expect(leftOutOf(planSave(set, ticksOf(set), SINGLE))).toEqual([["x1/income", NEEDS_CO_CLIENT]]);
  });

  it("doesn't name her: the client, or a name that only reads like a role", () => {
    const set = changeSetOf([
      lineOf("x1/account", "account", { name: "Joint", owners: [{ who: client, percent: 1 }] }),
      lineOf("x2/will", "will", { grantor: "client" }),
      lineOf("x3/income", "income", { end: { yearRef: "client_retirement" } }),
      lineOf("x4/will_bequest", "will_bequest", { kind: "asset", condition: "always", percentage: 100 }),
    ]);
    expect(savedIds(planSave(set, ticksOf(set), SINGLE))).toEqual(["x1/account", "x3/income", "x2/will", "x4/will_bequest"]);
  });

  it("with her first name ticked, the new joint account whose Owner is unticked is left out — it would be the client's alone", async () => {
    const changeSet = await review();
    const plan = planSave(changeSet, ticksOf(changeSet, { "cash1/account": ["owners"] }), SINGLE);
    expect(leftOutOf(plan)).toEqual([["cash1/account", "Who owns it isn't ticked."]]);
    expect(savedIds(plan)).not.toContain("cash1/account");
  });

  it("on a plan that has the co-client, unticking her first name leaves nothing out", async () => {
    const changeSet = await review();
    const plan = planSave(changeSet, ticksOf(changeSet, { "people:Co-client/client_household": ["spouseName"] }), { hasCoClient: true });
    expect(plan.ok && plan.leftOut).toEqual([]);
    expect(plan.ok && plan.lines).toHaveLength(9);
  });
});
