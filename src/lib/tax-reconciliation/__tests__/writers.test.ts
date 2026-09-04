import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { accountOwners, accounts, clientDeductions, clients, entities, incomes, medicareCoverage, planSettings } from "@/db/schema";

const m = vi.hoisted(() => ({
  update: vi.fn(), insert: vi.fn(), tx: vi.fn(),
  requireClientEditAccess: vi.fn(), requireActiveSubscriptionForFirm: vi.fn(), recordAudit: vi.fn(), baseCaseScenarioId: vi.fn(),
}));
// Every builder chain records {table, set/values, where} so a DROPPED scoping predicate
// reddens: with the db mocked a `where` is never evaluated, so it has to be asserted.
vi.mock("@/db", () => ({ db: {
  update: (table: object) => ({ set: (set: object) => ({ where: (where: object) => ({ returning: () => m.update({ table, set, where }) }) }) }),
  insert: (table: object) => ({ values: (values: object) => ({
    returning: () => m.insert({ table, values }),
    onConflictDoUpdate: (conflict: object) => m.insert({ table, values, conflict }),
  }) }),
  transaction: m.tx,
} }));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: m.requireClientEditAccess }));
vi.mock("@/lib/authz", () => ({ requireActiveSubscriptionForFirm: m.requireActiveSubscriptionForFirm }));
vi.mock("@/lib/audit", () => ({ recordAudit: m.recordAudit }));
vi.mock("@/lib/clients/base-case", () => ({ baseCaseScenarioId: m.baseCaseScenarioId }));

import {
  claimSocialSecurityForReturn, createDeductionForReturn, createEntityForReturn, updateClientFilingStatus,
  updateDeductionAmount, updateEntityTaxTreatment, updatePlanSettingsForReturn, upsertMedicarePriorYearMagi,
} from "../writers";

const c = { clientId: "c1", firmId: "org_1", actorId: "u1", crossFirmMeta: {} };

/** A transaction handle whose every write is recorded against THIS handle, so a test can
 *  prove two writes shared one transaction rather than merely both happening. */
type TxCall = { op: "insert" | "update"; table: object; values?: object; set?: object; where?: object };
function makeTx() {
  const calls: TxCall[] = [];
  const updateBehavior: Array<() => Promise<unknown>> = [];
  let updates = 0;
  const handle = {
    calls,
    /** Queue one result (or rejection) per `tx.update(...).returning()`, in order. */
    onUpdate(...fns: Array<() => Promise<unknown>>) { updateBehavior.push(...fns); },
    insert: (table: object) => ({ values: (values: object) => {
      calls.push({ op: "insert", table, values });
      const rows = table === entities ? [{ id: "e1", name: (values as { name: string }).name }] : [{ id: "acct-1" }];
      return { returning: () => Promise.resolve(rows) };
    } }),
    update: (table: object) => ({ set: (set: object) => ({ where: (where: object) => ({ returning: () => {
      calls.push({ op: "update", table, set, where });
      const fn = updateBehavior[updates++];
      return fn ? fn() : Promise.resolve([{ id: `row-${updates}` }]);
    } }) }) }),
  };
  return handle;
}
let tx: ReturnType<typeof makeTx>;

beforeEach(() => {
  vi.clearAllMocks();
  tx = makeTx();
  m.requireClientEditAccess.mockResolvedValue({ firmId: "org_1", access: "own", client: {} });
  m.baseCaseScenarioId.mockResolvedValue("sc-base");
  m.update.mockResolvedValue([{ id: "row" }]);
  m.insert.mockResolvedValue([{ id: "row" }]);
  // Run the callback for real against a recording handle; a real rejection inside it
  // rejects the transaction, exactly as the driver would.
  m.tx.mockImplementation((cb: (t: unknown) => Promise<unknown>) => Promise.resolve(cb(tx)));
});

/** Each writer with the smallest legal call, its audit action, and the resource it names. */
const ALL_WRITERS = [
  { name: "updatePlanSettingsForReturn", run: () => updatePlanSettingsForReturn({ ...c, patch: { residenceState: "PA" } }), action: "plan_settings.update" },
  { name: "updateClientFilingStatus", run: () => updateClientFilingStatus({ ...c, filingStatus: "single" }), action: "client.update" },
  { name: "createDeductionForReturn", run: () => createDeductionForReturn({ ...c, input: { type: "charitable" as const, name: "Giving", owner: "joint" as const, annualAmount: 5_000, growthRate: 0, startYear: 2026, endYear: 2060 } }), action: "deduction.create" },
  { name: "updateDeductionAmount", run: () => updateDeductionAmount({ ...c, deductionId: "d1", annualAmount: 7_000 }), action: "deduction.update" },
  { name: "createEntityForReturn", run: () => createEntityForReturn({ ...c, input: { name: "Acme LLC", entityType: "partnership" as const, taxTreatment: "qbi" as const, value: 0 } }), action: "entity.create" },
  { name: "updateEntityTaxTreatment", run: () => updateEntityTaxTreatment({ ...c, entityId: "en1", taxTreatment: "qbi" as const }), action: "entity.update" },
  { name: "upsertMedicarePriorYearMagi", run: () => upsertMedicarePriorYearMagi({ ...c, owner: "spouse" as const, priorYearMagi: 192_000 }), action: "medicare_coverage.upsert" },
  { name: "claimSocialSecurityForReturn", run: () => claimSocialSecurityForReturn({ ...c, rows: [{ incomeId: "s1", patch: { ssBenefitMode: "manual_amount", claimingAgeMode: "years", claimingAge: 67, startYear: 2026, inflationStartYear: 2025, annualAmount: 31_000 } }] }), action: "income.update" },
];

describe("writers — the gate every one of them shares", () => {
  it.each(ALL_WRITERS)("$name gates on edit access + subscription, then audits $action", async ({ run, action }) => {
    const r = await run();
    expect(r.ok).toBe(true);
    expect(m.requireClientEditAccess).toHaveBeenCalledWith("c1");
    expect(m.requireActiveSubscriptionForFirm).toHaveBeenCalledWith("org_1");
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action, clientId: "c1", firmId: "org_1", actorId: "u1",
      metadata: expect.objectContaining({ source: "plan_vs_return" }),
    }));
  });

  it.each(ALL_WRITERS)("$name refuses when the caller's firm is not the client's", async ({ run }) => {
    m.requireClientEditAccess.mockResolvedValue({ firmId: "org_other", access: "own", client: {} });
    expect(await run()).toMatchObject({ ok: false, status: 404 });
    expect(m.requireActiveSubscriptionForFirm).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.tx).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it.each(ALL_WRITERS)("$name carries the caller's cross-firm metadata into its audit", async ({ run }) => {
    Object.assign(c, { crossFirmMeta: { crossFirmActor: true, actorFirmId: "org_other" } });
    try {
      await run();
      expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ crossFirmActor: true, actorFirmId: "org_other", source: "plan_vs_return" }),
      }));
    } finally {
      Object.assign(c, { crossFirmMeta: {} });
    }
  });
});

describe("updatePlanSettingsForReturn", () => {
  it("validates the state code and a negative carryforward, and stringifies the decimal", async () => {
    expect(await updatePlanSettingsForReturn({ ...c, patch: { residenceState: "ZZ" } })).toMatchObject({ ok: false, status: 400 });
    expect(await updatePlanSettingsForReturn({ ...c, patch: { capitalLossCarryforwardLt: -5 } })).toMatchObject({ ok: false, status: 400 });
    expect(await updatePlanSettingsForReturn({ ...c, patch: { capitalLossCarryforwardLt: Number.NaN } })).toMatchObject({ ok: false, status: 400 });
    expect(m.update).not.toHaveBeenCalled();

    await updatePlanSettingsForReturn({ ...c, patch: { capitalLossCarryforwardLt: 12_000 } });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({
      table: planSettings,
      set: expect.objectContaining({ capitalLossCarryforwardLt: "12000" }),
      where: and(eq(planSettings.clientId, "c1"), eq(planSettings.scenarioId, "sc-base")),
    }));
  });

  it("writes only the keys the patch carries", async () => {
    await updatePlanSettingsForReturn({ ...c, patch: { residenceState: "PA" } });
    const set = m.update.mock.calls[0][0].set as Record<string, unknown>;
    expect(set.residenceState).toBe("PA");
    expect("capitalLossCarryforwardLt" in set).toBe(false);
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ fields: ["residenceState"] }) }));
  });

  it("404s when the client has no base case, and when no plan-settings row matches", async () => {
    m.baseCaseScenarioId.mockResolvedValue(null);
    expect(await updatePlanSettingsForReturn({ ...c, patch: { residenceState: "PA" } })).toMatchObject({ ok: false, status: 404 });
    expect(m.update).not.toHaveBeenCalled();

    m.baseCaseScenarioId.mockResolvedValue("sc-base");
    m.update.mockResolvedValue([]);
    expect(await updatePlanSettingsForReturn({ ...c, patch: { residenceState: "PA" } })).toMatchObject({ ok: false, status: 404 });
    expect(m.recordAudit).not.toHaveBeenCalled();
  });
});

describe("updateClientFilingStatus", () => {
  it("scopes the update to the client AND the firm", async () => {
    await updateClientFilingStatus({ ...c, filingStatus: "married_joint" });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({
      table: clients,
      set: expect.objectContaining({ filingStatus: "married_joint" }),
      where: and(eq(clients.id, "c1"), eq(clients.firmId, "org_1")),
    }));
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ resourceType: "client", resourceId: "c1", metadata: expect.objectContaining({ filingStatus: "married_joint" }) }));
  });

  it("404s without auditing when no row matches", async () => {
    m.update.mockResolvedValue([]);
    expect(await updateClientFilingStatus({ ...c, filingStatus: "single" })).toMatchObject({ ok: false, status: 404 });
    expect(m.recordAudit).not.toHaveBeenCalled();
  });
});

describe("deduction writers", () => {
  it("creates the charitable row in the base-case scenario with decimals stringified", async () => {
    await createDeductionForReturn({ ...c, input: { type: "charitable", name: "Giving (from 2025 return)", owner: "joint", annualAmount: 18_400, growthRate: 0, startYear: 2026, endYear: 2060 } });
    expect(m.insert).toHaveBeenCalledWith({ table: clientDeductions, values: {
      clientId: "c1", scenarioId: "sc-base", type: "charitable", name: "Giving (from 2025 return)", owner: "joint",
      annualAmount: "18400", growthRate: "0", startYear: 2026, endYear: 2060,
    } });
  });

  it("404s a create when the client has no base case", async () => {
    m.baseCaseScenarioId.mockResolvedValue(null);
    expect(await createDeductionForReturn({ ...c, input: { type: "charitable", name: "n", owner: "joint", annualAmount: 1, growthRate: 0, startYear: 2026, endYear: 2060 } })).toMatchObject({ ok: false, status: 404 });
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("scopes the amount update to the deduction AND the client, and 404s a miss", async () => {
    await updateDeductionAmount({ ...c, deductionId: "d1", annualAmount: 7_000 });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({
      table: clientDeductions,
      set: expect.objectContaining({ annualAmount: "7000" }),
      where: and(eq(clientDeductions.id, "d1"), eq(clientDeductions.clientId, "c1")),
    }));

    m.update.mockResolvedValue([]);
    expect(await updateDeductionAmount({ ...c, deductionId: "d1", annualAmount: 7_000 })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("entity writers", () => {
  it("creates the entity and its base-case cash account in one transaction", async () => {
    const r = await createEntityForReturn({ ...c, input: { name: "Acme LLC", entityType: "s_corp", taxTreatment: "qbi", value: 250_000 } });
    expect(r).toMatchObject({ ok: true, data: { id: "e1" } });
    expect(m.insert).not.toHaveBeenCalled(); // every write went through the transaction handle
    expect(tx.calls.map((x) => x.table)).toEqual([entities, accounts, accountOwners]);
    expect(tx.calls[0].values).toMatchObject({ clientId: "c1", name: "Acme LLC", entityType: "s_corp", taxTreatment: "qbi", value: "250000", basis: "0" });
    expect(tx.calls[1].values).toMatchObject({ clientId: "c1", scenarioId: "sc-base", name: "Acme LLC — Cash", category: "cash", subType: "checking", value: "0", isDefaultChecking: true });
    expect(tx.calls[2].values).toMatchObject({ accountId: "acct-1", entityId: "e1", familyMemberId: null, percent: "1.0000" });
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "entity.create", resourceId: "e1", metadata: expect.objectContaining({ name: "Acme LLC", entityType: "s_corp" }) }));
  });

  it("404s a create when the client has no base case", async () => {
    m.baseCaseScenarioId.mockResolvedValue(null);
    expect(await createEntityForReturn({ ...c, input: { name: "Acme LLC", entityType: "s_corp", taxTreatment: "qbi", value: 0 } })).toMatchObject({ ok: false, status: 404 });
    expect(m.tx).not.toHaveBeenCalled();
  });

  it("scopes the tax-treatment update to the entity AND the client, and 404s a miss", async () => {
    await updateEntityTaxTreatment({ ...c, entityId: "en1", taxTreatment: "qbi" });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({
      table: entities,
      set: expect.objectContaining({ taxTreatment: "qbi" }),
      where: and(eq(entities.id, "en1"), eq(entities.clientId, "c1")),
    }));

    m.update.mockResolvedValue([]);
    expect(await updateEntityTaxTreatment({ ...c, entityId: "en1", taxTreatment: "qbi" })).toMatchObject({ ok: false, status: 404 });
    expect(m.recordAudit).toHaveBeenCalledTimes(1);
  });
});

describe("upsertMedicarePriorYearMagi", () => {
  it("upserts the MAGI with the projection estimate switched off, on both arms of the conflict", async () => {
    await upsertMedicarePriorYearMagi({ ...c, owner: "spouse", priorYearMagi: 192_000 });
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({
      table: medicareCoverage,
      values: { clientId: "c1", owner: "spouse", priorYearMagi: "192000", estimatePriorYearMagiFromProjection: false },
      conflict: expect.objectContaining({
        target: [medicareCoverage.clientId, medicareCoverage.owner],
        set: expect.objectContaining({ priorYearMagi: "192000", estimatePriorYearMagiFromProjection: false }),
      }),
    }));
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "medicare_coverage.upsert", resourceType: "medicare_coverage", resourceId: "c1:spouse" }));
  });
});

describe("claimSocialSecurityForReturn", () => {
  const row = (incomeId: string, annualAmount: number, claimingAge = 67) => ({
    incomeId, patch: { ssBenefitMode: "manual_amount", claimingAgeMode: "years", claimingAge, startYear: 2026, inflationStartYear: 2025, annualAmount },
  });

  it("writes both halves of a split through ONE transaction handle, scoped to the client", async () => {
    const r = await claimSocialSecurityForReturn({ ...c, rows: [row("s1", 31_000), row("s2", 31_000, 65)] });
    expect(r).toMatchObject({ ok: true, data: { id: "s1" } });
    expect(m.tx).toHaveBeenCalledTimes(1);
    expect(m.update).not.toHaveBeenCalled(); // neither write escaped the transaction
    expect(tx.calls).toHaveLength(2);
    expect(tx.calls[0]).toMatchObject({ table: incomes, where: and(eq(incomes.id, "s1"), eq(incomes.clientId, "c1")) });
    expect(tx.calls[0].set).toMatchObject({ ssBenefitMode: "manual_amount", claimingAgeMode: "years", claimingAge: 67, startYear: 2026, inflationStartYear: 2025, annualAmount: "31000" });
    expect(tx.calls[1]).toMatchObject({ table: incomes, where: and(eq(incomes.id, "s2"), eq(incomes.clientId, "c1")) });
    expect(tx.calls[1].set).toMatchObject({ claimingAge: 65, annualAmount: "31000" });
    expect(m.recordAudit).toHaveBeenCalledTimes(2);
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "income.update", resourceType: "income", resourceId: "s2" }));
  });

  it("leaves NEITHER row changed when the second write fails — one transaction, no audit", async () => {
    tx.onUpdate(() => Promise.resolve([{ id: "s1" }]), () => Promise.reject(new Error("connection lost")));
    const r = await claimSocialSecurityForReturn({ ...c, rows: [row("s1", 31_000), row("s2", 31_000)] });
    expect(r).toMatchObject({ ok: false, status: 500 });
    // Both writes were issued on the SAME handle, so the driver's rollback covers the first.
    expect(tx.calls).toHaveLength(2);
    expect(m.tx).toHaveBeenCalledTimes(1);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it("rolls back and 404s when a row id does not belong to the client", async () => {
    tx.onUpdate(() => Promise.resolve([{ id: "s1" }]), () => Promise.resolve([]));
    expect(await claimSocialSecurityForReturn({ ...c, rows: [row("s1", 31_000), row("nope", 31_000)] })).toMatchObject({ ok: false, status: 404 });
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it("refuses a patch that carries a key it does not know how to write", async () => {
    const bad = { incomeId: "s1", patch: { ...row("s1", 31_000).patch, piaMonthly: 2_400 } };
    expect(await claimSocialSecurityForReturn({ ...c, rows: [bad] })).toMatchObject({ ok: false, status: 400 });
    expect(m.tx).not.toHaveBeenCalled();
  });

  it("refuses an empty row list rather than opening an empty transaction", async () => {
    expect(await claimSocialSecurityForReturn({ ...c, rows: [] })).toMatchObject({ ok: false, status: 400 });
    expect(m.tx).not.toHaveBeenCalled();
  });
});
