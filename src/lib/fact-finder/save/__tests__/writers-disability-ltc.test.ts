// src/lib/fact-finder/save/__tests__/writers-disability-ltc.test.ts
//
// The disability and long-term care save writers on a real transaction (live
// dev database): the Details write paths' rows and audit rows commit or roll
// back with the save, a rider is checked against a life policy created earlier
// in the same save, and a rider's stated benefit lands after the rider
// defaults that come with its type.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountOwners, accounts, auditLog, disabilityPolicies, lifeInsurancePolicies, ltcPolicies } from "@/db/schema";
import { LTC_RIDER_DEFAULTS } from "@/lib/schemas/ltc-policies";
import { contextOf, hendricksBook, rowOf, stateWith } from "../../placement/__tests__/fixtures";
import { diffDrafts } from "../../placement/diff";
import { DISABILITY_MAP } from "../../placement/map/insurance";
import { lineValues, payloadFor } from "../../placement/payload";
import { DISABILITY_LTC_WRITERS } from "../writers/disability-ltc";
import { SaveLineError } from "../types";
import { changeLine, dropSaveFirm, inputOf, inSave, REF_YEAR, seedSaveClient, type SaveSeed } from "./harness";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_dltc", orgRole: "org:admin" }),
}));

const FIRM = "firm_test_ff_save_dltc";
const disability = DISABILITY_LTC_WRITERS.disability_policy;
const ltc = DISABILITY_LTC_WRITERS.ltc_policy;
let seed: SaveSeed;
let scope: { clientId: string; firmId: string };

beforeAll(async () => {
  await dropSaveFirm(FIRM);
  seed = await seedSaveClient(FIRM, { coClient: true });
  scope = { clientId: seed.clientId, firmId: FIRM };
});
afterAll(() => dropSaveFirm(FIRM));

const auditOf = (id: string, action: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.resourceId, id), eq(auditLog.action, action)));
const anyAuditOf = (id: string) => db.select().from(auditLog).where(eq(auditLog.resourceId, id));
const disabilityRow = async (id: string) => (await db.select().from(disabilityPolicies).where(eq(disabilityPolicies.id, id)))[0];
const ltcRow = async (id: string) => (await db.select().from(ltcPolicies).where(eq(ltcPolicies.id, id)))[0];

const groupDisability = (name: string) => ({
  name,
  carrier: "Principal",
  insured: "client",
  coveredEarningsMode: "salary",
  hasShortTerm: true,
  stdEliminationDays: 7,
  stdBenefitPct: 0.6,
  stdDurationWeeks: 13,
  hasLongTerm: true,
  ltdEliminationDays: 90,
  ltdBenefitPct: 0.6,
  ltdMonthlyMax: 10000,
  ltdBenefitPeriodMode: "to_age",
  ltdBenefitPeriodAge: 65,
  benefitTaxable: false,
  colaRate: 0.02,
  annualPremium: 0,
  premiumPayer: "employer",
  notes: "Through the employer",
});

/** What the review's LTC map puts with each type (map/insurance.ts): a rider's terms, a standalone policy's cleared ones. */
const { riderBenefitMode, riderMonthlyPct, riderMaxPct, extensionYears, residualDeathBenefit, annualPremium, sharedCare } = LTC_RIDER_DEFAULTS;
const RIDER_TERMS = { riderBenefitMode, riderMonthlyPct, riderMaxPct, extensionYears, residualDeathBenefit, annualPremium, sharedCare };
const STANDALONE_TERMS = { lifePolicyAccountId: null, riderBenefitMode: null, riderMonthlyPct: null, riderMaxPct: null };
const FIXED_BENEFIT = { riderBenefitMode: "fixed", riderMonthlyPct: null };

const standaloneFields = (name: string) => ({
  name,
  carrier: "Genworth",
  insured: "client",
  kind: "standalone",
  issueYear: 2018,
  benefitAmount: 6000,
  benefitUnit: "month",
  benefitPeriodMode: "years",
  benefitPeriodYears: 3,
  eliminationDays: 90,
  homeCarePct: 1,
  benefitType: "reimbursement",
  partnership: true,
  inflationRider: "compound",
  inflationRate: 0.03,
  sharedCare: false,
  annualPremium: 4200,
  premiumPayMode: "lifetime",
});

/** Task 9's writer isn't in this lane: the life policy a rider sits on, inserted on the save's own transaction the way that writer leaves it. */
async function lifePolicy(tx: Parameters<Parameters<typeof inSave>[1]>[0]["tx"], insured: "client" | "spouse" | "joint") {
  const [account] = await tx
    .insert(accounts)
    .values({
      clientId: seed.clientId,
      scenarioId: seed.scenarioId,
      name: "NWM Whole Life",
      category: "life_insurance",
      subType: "whole_life",
      insuredPerson: insured,
      value: "0",
    })
    .returning({ id: accounts.id });
  await tx.insert(lifeInsurancePolicies).values({ accountId: account.id, policyType: "whole", faceValue: "500000" });
  await tx.insert(accountOwners).values({ accountId: account.id, familyMemberId: seed.clientMemberId, percent: "1" });
  return account.id;
}

const riderFields = (name: string, extra: Record<string, never | string | number> = {}) => ({
  name,
  insured: "client",
  kind: "life_rider",
  issueYear: 2020,
  lifePolicyAccountId: { ref: "line", target: "life_insurance_policy", lineId: "L-life" } as const,
  ...extra,
});
const riderLine = (name: string, opts: { amount?: number } = {}) =>
  changeLine(
    "ltc_policy",
    opts.amount ? { ...riderFields(name), benefitAmount: opts.amount } : riderFields(name),
    {
      dependsOn: ["L-life"],
      with: {
        kind: { ...RIDER_TERMS, ...(opts.amount ? FIXED_BENEFIT : {}) },
        ...(opts.amount ? { benefitAmount: FIXED_BENEFIT } : {}),
      },
    },
  );

describe("disability policy save writer", () => {
  it("(a) create and update commit: the policy and both audit rows are there", async () => {
    let id = "";
    const saved = await inSave(scope, async (ctx) => {
      id = await disability.create(ctx, inputOf(changeLine("disability_policy", groupDisability("Group LTD"))));
      return id;
    });
    expect(saved.result).toBe(id);
    const row = await disabilityRow(id);
    expect(row).toMatchObject({
      clientId: seed.clientId, name: "Group LTD", carrier: "Principal", insured: "client", hasShortTerm: true, hasLongTerm: true,
      ltdBenefitPeriodMode: "to_age", ltdBenefitPeriodAge: 65, benefitTaxable: false, premiumPayer: "employer", notes: "Through the employer",
    });
    expect(Number(row.ltdMonthlyMax)).toBe(10000);
    expect(row.stdMonthlyMax).toBeNull(); // no cap on the line: uncapped stays null, never "0"
    expect(await auditOf(id, "disability_policy.create")).toHaveLength(1);

    const update = changeLine("disability_policy", { ltdBenefitPct: 0.5, colaRate: 0.03 }, { recordId: id });
    await inSave(scope, (ctx) => disability.update(ctx, inputOf(update)));
    const after = await disabilityRow(id);
    expect(Number(after.ltdBenefitPct)).toBe(0.5);
    expect(Number(after.colaRate)).toBe(0.03);
    // Only the ticked fields moved.
    expect(after).toMatchObject({ name: "Group LTD", carrier: "Principal", notes: "Through the employer", ltdBenefitPeriodAge: 65 });
    expect(Number(after.ltdMonthlyMax)).toBe(10000);
    const [audit] = await auditOf(id, "disability_policy.update");
    expect((audit.metadata as { fieldsChanged: string[] }).fieldsChanged.sort()).toEqual(["colaRate", "ltdBenefitPct"]);
  });

  it("(b) a save that then throws leaves no policy and no audit row", async () => {
    let id = "";
    await inSave(
      scope,
      async (ctx) => {
        id = await disability.create(ctx, inputOf(changeLine("disability_policy", groupDisability("Rolled-back policy"))));
        await disability.update(ctx, inputOf(changeLine("disability_policy", { annualPremium: 300 }, { recordId: id })));
      },
      { rollback: true },
    );
    expect(id).not.toBe("");
    expect(await disabilityRow(id)).toBeUndefined();
    expect(await anyAuditOf(id)).toHaveLength(0);
  });

  it("(d) a policy the Details form would refuse is refused, with its reason; a policy of another client is never touched", async () => {
    const neither = changeLine("disability_policy", { ...groupDisability("Nothing covered"), hasShortTerm: false, hasLongTerm: false });
    await expect(inSave(scope, (ctx) => disability.create(ctx, inputOf(neither)))).rejects.toThrow(SaveLineError);
    await expect(inSave(scope, (ctx) => disability.create(ctx, inputOf(neither)))).rejects.toThrow(/short-term, long-term, or both/);

    const other = await seedSaveClient(FIRM);
    const [foreign] = await db.insert(disabilityPolicies).values({ clientId: other.clientId, name: "Not theirs", insured: "client" }).returning({ id: disabilityPolicies.id });
    const move = changeLine("disability_policy", { name: "Hijacked" }, { recordId: foreign.id });
    await expect(inSave(scope, (ctx) => disability.update(ctx, inputOf(move)))).rejects.toThrow(/Policy not found/);
    expect((await disabilityRow(foreign.id)).name).toBe("Not theirs");

    const noRecord = changeLine("disability_policy", { name: "No record" });
    await expect(inSave(scope, (ctx) => disability.update(ctx, { ...inputOf(noRecord), recordId: null }))).rejects.toThrow(SaveLineError);
  });

  it("(d) a new long-term-only policy saves with no short-term coverage, whatever the advisor unticks", async () => {
    // The review's own line: "Short-term coverage?" blank, no short-term terms (map/insurance.ts).
    const book = hendricksBook();
    const row = rowOf("di-ltd", { policyName: "Acme LTD", whoIsCovered: "Client", ltdWaitingDays: 90, ltdBenefitPercent: 60, benefitsRun: "To age", benefitsRunValue: 65 });
    const { ctx: placing } = contextOf(stateWith({ disability: [row] }), book);
    const [line] = diffDrafts(DISABILITY_MAP.place([row], placing), book);
    const ticks = Object.fromEntries(line.fields.map((f) => [f.key, f.ticked]));
    // Every field ticked, then "Short-term coverage" (and anything else) unticked: the row has no short-term coverage.
    const untickings: Record<string, boolean>[] = [{}, { hasShortTerm: false }, { hasShortTerm: false, hasLongTerm: false }];
    for (const unticked of untickings) {
      const values = lineValues(line, { ...ticks, ...unticked });
      const body = payloadFor(line.target, values, { id: () => { throw new Error("no refs on this line"); }, year: () => REF_YEAR });
      const id = (await inSave(scope, (ctx) => disability.create(ctx, { ...inputOf(line), values, body }))).result;
      expect(await disabilityRow(id), JSON.stringify(unticked)).toMatchObject({ name: "Acme LTD", hasShortTerm: false, hasLongTerm: true, ltdBenefitPeriodAge: 65 });
    }
  });

  it("(e) a disability save queues no after-commit work", async () => {
    const saved = await inSave(scope, (ctx) => disability.create(ctx, inputOf(changeLine("disability_policy", groupDisability("Queue check")))));
    expect(saved.queued).toBe(0);
  });
});

describe("long-term care policy save writer", () => {
  it("(a) create and update commit: the policy, its carrier and both audit rows are there", async () => {
    let id = "";
    await inSave(scope, async (ctx) => {
      id = await ltc.create(ctx, inputOf(changeLine("ltc_policy", standaloneFields("Genworth LTC"), { with: { kind: STANDALONE_TERMS } })));
    });
    const row = await ltcRow(id);
    expect(row).toMatchObject({
      clientId: seed.clientId, name: "Genworth LTC", carrier: "Genworth", kind: "standalone", benefitPeriodMode: "years", benefitPeriodYears: 3,
      lifePolicyAccountId: null, partnership: true, inflationRider: "compound", premiumPayMode: "lifetime",
    });
    expect(Number(row.benefitAmount)).toBe(6000);
    expect(Number(row.annualPremium)).toBe(4200);
    expect(await auditOf(id, "ltc_policy.create")).toHaveLength(1);

    const update = changeLine("ltc_policy", { benefitAmount: 7500, eliminationDays: 60 }, { recordId: id });
    await inSave(scope, (ctx) => ltc.update(ctx, inputOf(update)));
    const after = await ltcRow(id);
    expect(Number(after.benefitAmount)).toBe(7500);
    expect(after).toMatchObject({ eliminationDays: 60, name: "Genworth LTC", carrier: "Genworth", benefitPeriodYears: 3 });
    // The audit row lists only the columns that changed.
    const [audit] = await auditOf(id, "ltc_policy.update");
    expect((audit.metadata as { fieldsChanged: string[] }).fieldsChanged.sort()).toEqual(["benefitAmount", "eliminationDays"]);
  });

  it("(b) a save that then throws leaves no policy and no audit row", async () => {
    let id = "";
    await inSave(
      scope,
      async (ctx) => {
        id = await ltc.create(ctx, inputOf(changeLine("ltc_policy", standaloneFields("Rolled-back LTC"), { with: { kind: STANDALONE_TERMS } })));
        await ltc.update(ctx, inputOf(changeLine("ltc_policy", { benefitAmount: 1 }, { recordId: id })));
      },
      { rollback: true },
    );
    expect(id).not.toBe("");
    expect(await ltcRow(id)).toBeUndefined();
    expect(await anyAuditOf(id)).toHaveLength(0);
  });

  it("(c) a rider on a life policy created earlier in the save, insuring the same person, is saved", async () => {
    let id = "";
    let policyId = "";
    await inSave(scope, async (ctx) => {
      policyId = await lifePolicy(ctx.tx, "client");
      id = await ltc.create(ctx, inputOf(riderLine("NWM LTC rider"), { "line:L-life": policyId }));
    });
    const row = await ltcRow(id);
    expect(row).toMatchObject({
      kind: "life_rider", lifePolicyAccountId: policyId, riderBenefitMode: "pct_of_face", benefitPeriodMode: null,
      premiumPayMode: "paid_up", sharedCare: false,
    });
    expect(Number(row.riderMonthlyPct)).toBe(0.02);
    expect(Number(row.riderMaxPct)).toBe(1);
    expect(Number(row.annualPremium)).toBe(0);
    expect(await auditOf(id, "ltc_policy.create")).toHaveLength(1);
  });

  it("(c) the same rider on a life policy that insures the other person is refused with the route's message, and nothing remains", async () => {
    let id = "";
    let policyId = "";
    await expect(
      inSave(scope, async (ctx) => {
        policyId = await lifePolicy(ctx.tx, "spouse");
        id = await ltc.create(ctx, inputOf(riderLine("Wrong person rider"), { "line:L-life": policyId }));
      }),
    ).rejects.toThrow(new SaveLineError("The life policy must insure the same person as the rider."));
    expect(id).toBe("");
    expect(await db.select().from(accounts).where(eq(accounts.id, policyId))).toHaveLength(0);
  });

  it("(c) a rider on a joint policy, and on a record that is no life policy, are refused", async () => {
    await expect(
      inSave(scope, async (ctx) => {
        const policyId = await lifePolicy(ctx.tx, "joint");
        await ltc.create(ctx, inputOf(riderLine("Joint rider"), { "line:L-life": policyId }));
      }),
    ).rejects.toThrow(/joint \(second-to-die\)/);
    const [house] = await db
      .insert(accounts)
      .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "A house", category: "real_estate", subType: "primary_residence" })
      .returning({ id: accounts.id });
    await expect(
      inSave(scope, (ctx) => ltc.create(ctx, inputOf(riderLine("House rider"), { "line:L-life": house.id }))),
    ).rejects.toThrow(/Pick one of this household's life insurance policies/);
  });

  it("(c) a rider saved in a save that rolls back leaves neither the rider nor the life policy", async () => {
    let id = "";
    let policyId = "";
    await inSave(
      scope,
      async (ctx) => {
        policyId = await lifePolicy(ctx.tx, "client");
        id = await ltc.create(ctx, inputOf(riderLine("Ghost rider"), { "line:L-life": policyId }));
      },
      { rollback: true },
    );
    expect(await ltcRow(id)).toBeUndefined();
    expect(await db.select().from(accounts).where(eq(accounts.id, policyId))).toHaveLength(0);
    expect(await anyAuditOf(id)).toHaveLength(0);
  });

  it("(c) an update that moves a standalone policy onto a life policy created earlier in the save keeps the merged-record rules", async () => {
    let id = "";
    await inSave(scope, async (ctx) => {
      id = await ltc.create(ctx, inputOf(changeLine("ltc_policy", standaloneFields("Becomes a rider"), { with: { kind: STANDALONE_TERMS } })));
    });
    let policyId = "";
    await inSave(scope, async (ctx) => {
      policyId = await lifePolicy(ctx.tx, "client");
      const line = changeLine(
        "ltc_policy",
        { kind: "life_rider", lifePolicyAccountId: { ref: "line", target: "life_insurance_policy", lineId: "L-life" } },
        { recordId: id, dependsOn: ["L-life"], with: { kind: RIDER_TERMS } },
      );
      await ltc.update(ctx, inputOf(line, { "line:L-life": policyId }));
    });
    const after = await ltcRow(id);
    // The type's leftovers are cleared exactly as the Details form clears them.
    expect(after).toMatchObject({ kind: "life_rider", lifePolicyAccountId: policyId, benefitPeriodMode: null, benefitPeriodYears: null, premiumPayMode: "paid_up", partnership: true });
    expect(Number(after.annualPremium)).toBe(0);
    expect(Number(after.benefitAmount)).toBe(0);
    const [audit] = await auditOf(id, "ltc_policy.update");
    expect((audit.metadata as { fieldsChanged: string[] }).fieldsChanged).toEqual(expect.arrayContaining(["kind", "lifePolicyAccountId", "riderBenefitMode", "benefitPeriodMode", "annualPremium"]));
  });

  it("(d) a rider's stated benefit lands after the rider defaults that come with its type", async () => {
    let id = "";
    await inSave(scope, async (ctx) => {
      const policyId = await lifePolicy(ctx.tx, "client");
      id = await ltc.create(ctx, inputOf(riderLine("Fixed benefit rider", { amount: 3000 }), { "line:L-life": policyId }));
    });
    const row = await ltcRow(id);
    expect(row.riderBenefitMode).toBe("fixed");
    expect(row.riderMonthlyPct).toBeNull();
    expect(Number(row.benefitAmount)).toBe(3000);
  });

  it("(d) a policy the Details form would refuse is refused with its reason; a policy of another client is never touched", async () => {
    const noTerms = changeLine("ltc_policy", { name: "No terms", insured: "client", issueYear: 2020 });
    await expect(inSave(scope, (ctx) => ltc.create(ctx, inputOf(noTerms)))).rejects.toThrow(/benefitAmount: Enter the policy's benefit amount/);

    const other = await seedSaveClient(FIRM);
    const [foreign] = await db
      .insert(ltcPolicies)
      .values({ clientId: other.clientId, name: "Not theirs", insured: "client", issueYear: 2019, benefitAmount: "5000", benefitPeriodMode: "lifetime" })
      .returning({ id: ltcPolicies.id });
    const move = changeLine("ltc_policy", { name: "Hijacked" }, { recordId: foreign.id });
    await expect(inSave(scope, (ctx) => ltc.update(ctx, inputOf(move)))).rejects.toThrow(/Policy not found/);
    expect((await ltcRow(foreign.id)).name).toBe("Not theirs");

    await expect(inSave(scope, (ctx) => ltc.update(ctx, { ...inputOf(move), recordId: null }))).rejects.toThrow(SaveLineError);
  });

  it("(e) an LTC save queues no after-commit work", async () => {
    const saved = await inSave(scope, (ctx) =>
      ltc.create(ctx, inputOf(changeLine("ltc_policy", standaloneFields("Queue check"), { with: { kind: STANDALONE_TERMS } }))),
    );
    expect(saved.queued).toBe(0);
  });
});
