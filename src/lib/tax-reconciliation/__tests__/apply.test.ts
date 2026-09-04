import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionTarget, Reconciliation, Suggestion } from "../types";

const m = vi.hoisted(() => ({
  computeReconciliation: vi.fn(), createIncomeForClient: vi.fn(), updateIncomeForClient: vi.fn(), updateExpenseForClient: vi.fn(),
  createSavingsRuleForClient: vi.fn(), updateSavingsRuleForClient: vi.fn(), recordAudit: vi.fn(),
  updatePlanSettingsForReturn: vi.fn(), updateClientFilingStatus: vi.fn(), createDeductionForReturn: vi.fn(), updateDeductionAmount: vi.fn(),
  createEntityForReturn: vi.fn(), updateEntityTaxTreatment: vi.fn(), upsertMedicarePriorYearMagi: vi.fn(), transaction: vi.fn(),
  requireClientEditAccess: vi.fn(), requireActiveSubscriptionForFirm: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { transaction: m.transaction } }));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: m.requireClientEditAccess }));
vi.mock("@/lib/authz", () => ({ requireActiveSubscriptionForFirm: m.requireActiveSubscriptionForFirm }));
vi.mock("../reconcile", () => ({ computeReconciliation: m.computeReconciliation }));
vi.mock("@/lib/clients/incomes-writes", () => ({ createIncomeForClient: m.createIncomeForClient, updateIncomeForClient: m.updateIncomeForClient }));
vi.mock("@/lib/clients/expenses-writes", () => ({ updateExpenseForClient: m.updateExpenseForClient }));
vi.mock("@/lib/clients/savings-rules-writes", () => ({ createSavingsRuleForClient: m.createSavingsRuleForClient, updateSavingsRuleForClient: m.updateSavingsRuleForClient }));
vi.mock("@/lib/audit", () => ({ recordAudit: m.recordAudit }));
vi.mock("../writers", () => ({
  updatePlanSettingsForReturn: m.updatePlanSettingsForReturn, updateClientFilingStatus: m.updateClientFilingStatus, createDeductionForReturn: m.createDeductionForReturn,
  updateDeductionAmount: m.updateDeductionAmount, createEntityForReturn: m.createEntityForReturn, updateEntityTaxTreatment: m.updateEntityTaxTreatment,
  upsertMedicarePriorYearMagi: m.upsertMedicarePriorYearMagi,
}));

import { applySuggestion } from "../apply";

/** Every write mock, so a routing test can prove exactly ONE of them fired. */
const WRITERS = {
  createIncomeForClient: m.createIncomeForClient, updateIncomeForClient: m.updateIncomeForClient, updateExpenseForClient: m.updateExpenseForClient,
  createSavingsRuleForClient: m.createSavingsRuleForClient, updateSavingsRuleForClient: m.updateSavingsRuleForClient,
  updatePlanSettingsForReturn: m.updatePlanSettingsForReturn, updateClientFilingStatus: m.updateClientFilingStatus,
  createDeductionForReturn: m.createDeductionForReturn, updateDeductionAmount: m.updateDeductionAmount,
  createEntityForReturn: m.createEntityForReturn, updateEntityTaxTreatment: m.updateEntityTaxTreatment,
  upsertMedicarePriorYearMagi: m.upsertMedicarePriorYearMagi,
} as const;
type WriterName = keyof typeof WRITERS;

/** The handle `db.transaction` hands its callback. Both halves of a split must carry
 *  THIS object, which is what makes them one transaction. */
const TX = { __transaction: true };
let rolledBack = false;

const base = (over: Partial<Suggestion>): Suggestion => ({ id: "x", section: "income", kind: "update", status: "open", headline: "", meaning: "", returnFigure: { label: "", amount: null, display: "", lineRefs: [] }, planFigure: { label: "", amount: null, display: "", year: 2026 }, delta: { amount: null, display: "", tone: "neutral" }, ...over });
const w2Create = base({ id: "income.wages.w2.0.create", action: { label: "", describe: 'Adds a salary "Globex" of $90,000 (2025 dollars)', amountEditable: true, defaultAmount: 90_000, ownerChoices: ["client", "spouse"],
  target: { kind: "income.create", amountField: "annualAmount", ownerField: "owner", input: { type: "salary", name: "Globex", owner: "client", annualAmount: 90_000, endYearRef: "client_retirement", startYear: 2026, endYear: 2060 } } } });
const ssClaim = base({ id: "income.socialSecurity", action: { label: "", describe: "", amountEditable: true, defaultAmount: 62_000, ownerChoices: ["client", "spouse", "split"],
  target: { kind: "income.socialSecurity.claim", amount: 62_000, rows: [{ owner: "client", incomeId: "s1", patch: { ssBenefitMode: "manual_amount" } }, { owner: "spouse", incomeId: "s2", patch: { ssBenefitMode: "manual_amount" } }] } } });
const filing = base({ id: "household.filingStatus", section: "household", action: { label: "", describe: "Sets the household's filing status to Single", amountEditable: false, defaultAmount: null, target: { kind: "client.update", patch: { filingStatus: "single" } } } });
/** A matched Schedule C LOSS. The rules emit these, so a negative default has to survive the applier. */
const scheduleCLoss = base({ id: "business.scheduleC.0.create", section: "business", action: { label: "", describe: 'Adds business income "Consulting" of -$12,000 (2025 dollars)', amountEditable: true, defaultAmount: -12_000,
  target: { kind: "income.create", amountField: "annualAmount", ownerField: "owner", input: { type: "business", name: "Consulting", owner: "client", annualAmount: -12_000, startYear: 2026, endYear: 2060 } } } });
/** A review item: it exists to be read, and carries no `action` at all. */
const noAction = base({ id: "income.socialSecurity.noProjection", kind: "review" });
/** Exactly ONE claimable row and it is the SPOUSE's, so `rules/social-security.ts`
 *  offers no owner choice. Reachable on an MFJ household whose client-side row is
 *  joint, ended, or has no date of birth. */
const ssSpouseOnly = base({ id: "income.socialSecurity", action: { label: "", describe: "", amountEditable: true, defaultAmount: 40_000,
  target: { kind: "income.socialSecurity.claim", amount: 40_000, rows: [{ owner: "spouse", incomeId: "sp1", patch: { ssBenefitMode: "manual_amount" } }] } } });
/** A create whose target names a spouse owner with no choice offered. */
const spouseCreate = base({ id: "income.rental.create", action: { label: "", describe: "", amountEditable: true, defaultAmount: 20_000,
  target: { kind: "income.create", amountField: "annualAmount", ownerField: "owner", input: { type: "other", name: "Rental", owner: "spouse", annualAmount: 20_000 } } } });

const recon = (open: Suggestion[], dismissed: Suggestion[] = [], checks: Reconciliation["checks"] = []): Reconciliation => ({ taxYear: 2025, planYear: 2026, planStartYear: 2026, status: "ready", overview: { totalIncome: { return: null, plan: null }, federalTax: { return: null, plan: null }, agi: { return: null, plan: null }, effectiveRate: { return: null, plan: null }, openCount: open.length, dismissedCount: dismissed.length, inLineCount: checks.length }, sections: open.length ? [{ id: "income", title: "Income", items: open }] : [], checks, dismissed, notes: [], dismissalsUnavailable: false });
const args = (over = {}) => ({ clientId: "c1", firmId: "org_1", actorId: "user_1", callerOrgId: "org_1", taxYear: 2025, suggestionId: "income.wages.w2.0.create", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  m.computeReconciliation.mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon([w2Create, ssClaim, filing, scheduleCLoss, noAction]) });
  for (const f of Object.values(WRITERS)) f.mockResolvedValue({ ok: true, data: { id: "new" }, resourceId: "new" });
  // Stands in for the driver: run the callback, and on a throw record the ROLLBACK
  // and re-raise, exactly as neon-serverless does.
  rolledBack = false;
  m.transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) => {
    try { return await cb(TX); } catch (err) { rolledBack = true; throw err; }
  });
  m.requireClientEditAccess.mockResolvedValue({ firmId: "org_1", access: "own", client: {} });
  m.requireActiveSubscriptionForFirm.mockResolvedValue(undefined);
});

describe("applySuggestion — the gate at the top", () => {
  it("refuses a caller without edit permission before it reads or writes anything", async () => {
    m.requireClientEditAccess.mockRejectedValue(new Error("Edit access required"));
    await expect(applySuggestion(args())).rejects.toThrow("Edit access required");
    expect(m.computeReconciliation).not.toHaveBeenCalled();
    for (const f of Object.values(WRITERS)) expect(f).not.toHaveBeenCalled();
  });

  it("refuses when the caller's firm is not the client's, before the subscription check", async () => {
    m.requireClientEditAccess.mockResolvedValue({ firmId: "org_other", access: "own", client: {} });
    expect(await applySuggestion(args())).toMatchObject({ ok: false, status: 404 });
    expect(m.requireActiveSubscriptionForFirm).not.toHaveBeenCalled();
    expect(m.computeReconciliation).not.toHaveBeenCalled();
  });

  it("refuses when the firm has no active subscription", async () => {
    m.requireActiveSubscriptionForFirm.mockRejectedValue(new Error("Active subscription required"));
    await expect(applySuggestion(args())).rejects.toThrow("Active subscription required");
    expect(m.computeReconciliation).not.toHaveBeenCalled();
    for (const f of Object.values(WRITERS)) expect(f).not.toHaveBeenCalled();
  });
});

describe("applySuggestion", () => {
  it("uses the recomputed suggestion's own target, substituting amount and owner overrides (spouse swaps the retirement ref)", async () => {
    const r = await applySuggestion(args({ amount: 95_000, owner: "spouse" }));
    expect(r.ok).toBe(true);
    expect(m.createIncomeForClient).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", firmId: "org_1", actorId: "user_1",
      input: expect.objectContaining({ name: "Globex", annualAmount: 95_000, owner: "spouse", endYearRef: "spouse_retirement" }) }));
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tax_reconciliation.apply", resourceType: "tax_return", resourceId: "c1:2025", clientId: "c1", firmId: "org_1", actorId: "user_1", metadata: expect.objectContaining({ suggestionId: "income.wages.w2.0.create", kind: "income.create", amount: 95_000, owner: "spouse" }) }));
    expect(m.computeReconciliation).toHaveBeenCalledTimes(2); // before and after
    expect(r.ok && r.applied.summary).toBe('Adds a salary "Globex" of $95,000 (2025 dollars)');
  });

  it("ignores a forged target on the body and defaults the owner to client", async () => {
    const r = await applySuggestion({ ...args(), target: { kind: "client.update", patch: { filingStatus: "single" } } } as never);
    expect(r.ok).toBe(true);
    expect(m.updateClientFilingStatus).not.toHaveBeenCalled();
    expect(m.createIncomeForClient).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ owner: "client", annualAmount: 90_000, endYearRef: "client_retirement" }) }));
    // The audit has to name the owner the write actually went to, not "not stated".
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ owner: "client" }) }));
  });

  it("returns the bundle recomputed AFTER the write, not the one it decided from", async () => {
    m.computeReconciliation.mockResolvedValueOnce({ ok: true, taxReturnId: "tr-1", reconciliation: recon([w2Create]) });
    m.computeReconciliation.mockResolvedValueOnce({ ok: true, taxReturnId: "tr-1", reconciliation: recon([], [], [{ id: "income.wages.w2.0.create", label: "", returnDisplay: "", planDisplay: "" }]) });
    const r = await applySuggestion(args());
    expect(r.ok).toBe(true);
    expect(r.ok && r.reconciliation.checks).toHaveLength(1);
    expect(r.ok && r.reconciliation.sections).toHaveLength(0);
  });

  it("keeps a negative default amount — a Schedule C or rental loss is a real figure", async () => {
    const r = await applySuggestion(args({ suggestionId: "business.scheduleC.0.create" }));
    expect(r.ok).toBe(true);
    expect(m.createIncomeForClient).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ name: "Consulting", annualAmount: -12_000 }) }));
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ amount: -12_000 }) }));
  });

  it("splits a two-row Social Security claim in half, or sends the whole amount to one row", async () => {
    await applySuggestion(args({ suggestionId: "income.socialSecurity", owner: "split" }));
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.updateIncomeForClient).toHaveBeenCalledTimes(2);
    // Both halves carry the SAME handle: that, not the loop, is what makes them atomic.
    expect(m.updateIncomeForClient).toHaveBeenNthCalledWith(1, expect.objectContaining({ clientId: "c1", firmId: "org_1", actorId: "user_1", incomeId: "s1", input: { ssBenefitMode: "manual_amount", annualAmount: 31_000 }, tx: TX }));
    expect(m.updateIncomeForClient).toHaveBeenNthCalledWith(2, expect.objectContaining({ incomeId: "s2", input: { ssBenefitMode: "manual_amount", annualAmount: 31_000 }, tx: TX }));

    m.updateIncomeForClient.mockClear(); m.transaction.mockClear();
    await applySuggestion(args({ suggestionId: "income.socialSecurity", owner: "spouse", amount: 60_000 }));
    expect(m.updateIncomeForClient).toHaveBeenCalledTimes(1);
    expect(m.updateIncomeForClient).toHaveBeenCalledWith(expect.objectContaining({ incomeId: "s2", input: { ssBenefitMode: "manual_amount", annualAmount: 60_000 }, tx: TX }));
  });

  it("leaves NEITHER row changed when the second write of a split fails", async () => {
    m.updateIncomeForClient.mockResolvedValueOnce({ ok: true, data: { id: "s1" }, resourceId: "s1" });
    m.updateIncomeForClient.mockResolvedValueOnce({ ok: false, status: 404, error: "Income not found" });
    const r = await applySuggestion(args({ suggestionId: "income.socialSecurity", owner: "split" }));
    // The core's own rejection reaches the advisor, not a generic 500 …
    expect(r).toEqual({ ok: false, status: 404, error: "Income not found" });
    // … and the callback threw, so the driver rolls back — the first row goes with it.
    expect(rolledBack).toBe(true);
    expect(m.updateIncomeForClient).toHaveBeenCalledTimes(2);
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it("maps an unexpected transaction failure to a 500 without auditing", async () => {
    m.updateIncomeForClient.mockRejectedValueOnce(new Error("connection lost"));
    const r = await applySuggestion(args({ suggestionId: "income.socialSecurity", owner: "split" }));
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(rolledBack).toBe(true);
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it("rejects a bad amount, an amount on a non-editable action, and an owner not offered", async () => {
    expect(await applySuggestion(args({ amount: -1 }))).toMatchObject({ ok: false, status: 400 });
    expect(await applySuggestion(args({ amount: 2e9 }))).toMatchObject({ ok: false, status: 400 });
    expect(await applySuggestion(args({ amount: Number.NaN }))).toMatchObject({ ok: false, status: 400 });
    expect(await applySuggestion(args({ suggestionId: "household.filingStatus", amount: 5 }))).toMatchObject({ ok: false, status: 400 });
    expect(await applySuggestion(args({ owner: "split" }))).toMatchObject({ ok: false, status: 400 });
    for (const f of Object.values(WRITERS)) expect(f).not.toHaveBeenCalled();
  });

  it("writes the row the target NAMES when the card offered no owner choice", async () => {
    m.computeReconciliation.mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon([ssSpouseOnly]) });
    const r = await applySuggestion(args({ suggestionId: "income.socialSecurity" }));
    // Defaulting the filter to "client" here made every click on a spouse-only claim a 400.
    expect(r.ok).toBe(true);
    expect(m.updateIncomeForClient).toHaveBeenCalledWith(expect.objectContaining({ incomeId: "sp1", input: { ssBenefitMode: "manual_amount", annualAmount: 40_000 } }));
  });

  it("leaves a create's own owner alone when the card offered no owner choice", async () => {
    m.computeReconciliation.mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon([spouseCreate]) });
    const r = await applySuggestion(args({ suggestionId: "income.rental.create" }));
    expect(r.ok).toBe(true);
    expect(m.createIncomeForClient).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ owner: "spouse" }) }));
  });

  it("gives the odd cent of a split to the last row so the halves still sum to the total", async () => {
    const odd = base({ id: "income.socialSecurity", action: { label: "", describe: "", amountEditable: true, defaultAmount: 62_000.01, ownerChoices: ["client", "spouse", "split"],
      target: { kind: "income.socialSecurity.claim", amount: 62_000.01, rows: [{ owner: "client", incomeId: "s1", patch: {} }, { owner: "spouse", incomeId: "s2", patch: {} }] } } });
    m.computeReconciliation.mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon([odd]) });
    await applySuggestion(args({ suggestionId: "income.socialSecurity", owner: "split" }));
    const amounts = m.updateIncomeForClient.mock.calls.map((call) => (call[0] as { input: { annualAmount: number } }).input.annualAmount);
    expect(amounts).toEqual([31_000, 31_000.01]);
    // `incomes.annual_amount` is decimal(15,2), so the halves are compared in whole cents:
    // an even split would store 31,000.00 twice and lose the household's odd cent.
    expect(amounts.reduce((t, v) => t + Math.round(v * 100), 0)).toBe(6_200_001);
  });

  it("divides a same-owner multi-row claim too — the gross is the HOUSEHOLD's, not each row's", async () => {
    // `claimRows` filters on owner-is-a-person / not-ended / DOB-present, so nothing stops
    // two rows sharing an owner. Two rows make the owner picker appear; picking "client"
    // used to write the whole household gross to BOTH, doubling the benefit in one click.
    const twoClientRows = base({ id: "income.socialSecurity", action: { label: "", describe: "", amountEditable: true, defaultAmount: 50_000, ownerChoices: ["client", "spouse", "split"],
      target: { kind: "income.socialSecurity.claim", amount: 50_000, rows: [
        { owner: "client", incomeId: "c1a", patch: {} }, { owner: "client", incomeId: "c1b", patch: {} }, { owner: "spouse", incomeId: "sp1", patch: {} }] } } });
    m.computeReconciliation.mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon([twoClientRows]) });
    await applySuggestion(args({ suggestionId: "income.socialSecurity", owner: "client" }));
    const calls = m.updateIncomeForClient.mock.calls.map((call) => call[0] as { incomeId: string; input: { annualAmount: number } });
    expect(calls.map((x) => x.incomeId)).toEqual(["c1a", "c1b"]);
    expect(calls.map((x) => x.input.annualAmount)).toEqual([25_000, 25_000]);
    expect(calls.reduce((t, x) => t + Math.round(x.input.annualAmount * 100), 0)).toBe(5_000_000);
  });

  it("leaves a single-row claim on the exact gross, bit for bit", async () => {
    m.computeReconciliation.mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon([ssSpouseOnly]) });
    await applySuggestion(args({ suggestionId: "income.socialSecurity" }));
    expect(m.updateIncomeForClient).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ annualAmount: 40_000 }) }));
  });

  it("rejects a suggestion that carries no action instead of crashing", async () => {
    expect(await applySuggestion(args({ suggestionId: "income.socialSecurity.noProjection" }))).toMatchObject({ ok: false, status: 400 });
    for (const f of Object.values(WRITERS)) expect(f).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it("404s an unknown id and 409s a stale one (dismissed or now in line), returning the fresh bundle", async () => {
    expect(await applySuggestion(args({ suggestionId: "nope" }))).toMatchObject({ ok: false, status: 404 });
    m.computeReconciliation.mockResolvedValueOnce({ ok: true, taxReturnId: "tr-1", reconciliation: recon([], [], [{ id: "income.wages.w2.0.create", label: "", returnDisplay: "", planDisplay: "" }]) });
    const stale = await applySuggestion(args());
    expect(stale).toMatchObject({ ok: false, status: 409, error: "stale" });
    expect(stale.ok === false && stale.reconciliation?.checks.length).toBe(1);

    m.computeReconciliation.mockResolvedValueOnce({ ok: true, taxReturnId: "tr-1", reconciliation: recon([], [{ ...w2Create, status: "dismissed" }]) });
    expect(await applySuggestion(args())).toMatchObject({ ok: false, status: 409, error: "stale" });
    for (const f of Object.values(WRITERS)) expect(f).not.toHaveBeenCalled();
  });

  it("passes a core's rejection through verbatim and maps a load failure", async () => {
    m.createIncomeForClient.mockResolvedValueOnce({ ok: false, status: 400, error: "Invalid input; startYear" });
    expect(await applySuggestion(args())).toEqual({ ok: false, status: 400, error: "Invalid input; startYear" });
    expect(m.recordAudit).not.toHaveBeenCalled();
    m.computeReconciliation.mockResolvedValueOnce({ ok: false, code: "no_plan", message: "no plan" });
    expect(await applySuggestion(args())).toMatchObject({ ok: false, status: 409, error: "no_plan" });
    m.computeReconciliation.mockResolvedValueOnce({ ok: false, code: "not_found", message: "gone" });
    expect(await applySuggestion(args())).toMatchObject({ ok: false, status: 404, error: "not_found" });
  });

  it("returns the pre-write bundle when the recompute after a successful write fails", async () => {
    m.computeReconciliation.mockResolvedValueOnce({ ok: true, taxReturnId: "tr-1", reconciliation: recon([w2Create]) });
    m.computeReconciliation.mockResolvedValueOnce({ ok: false, code: "facts_unreadable", message: "boom" });
    const r = await applySuggestion(args());
    expect(r.ok).toBe(true);
    expect(r.ok && r.reconciliation.sections[0].items[0].id).toBe("income.wages.w2.0.create");
  });
});

/** R66: `dispatch()` is one big routing decision, so every ActionTarget kind the rules
 *  emit needs a fixture that reddens if it is routed to the wrong writer. Each row
 *  asserts BOTH that its own writer fired and that no other writer did. */
describe("applySuggestion routing — every ActionTarget kind reaches its own writer", () => {
  const cases: Array<{ target: ActionTarget; fn: WriterName; expect: Record<string, unknown>; txn?: boolean }> = [
    { target: { kind: "income.create", amountField: "annualAmount", input: { name: "n" } }, fn: "createIncomeForClient", expect: { input: { name: "n" } } },
    { target: { kind: "income.update", incomeId: "i1", patch: { annualAmount: 10 }, amountField: "annualAmount" }, fn: "updateIncomeForClient", expect: { incomeId: "i1", input: { annualAmount: 10 } } },
    { target: { kind: "income.socialSecurity.claim", amount: 100, rows: [{ owner: "client", incomeId: "s1", patch: { ssBenefitMode: "manual_amount" } }] }, fn: "updateIncomeForClient", expect: { incomeId: "s1", input: { ssBenefitMode: "manual_amount", annualAmount: 100 }, tx: TX }, txn: true },
    { target: { kind: "expense.update", expenseId: "e1", patch: { annualAmount: 20 }, amountField: "annualAmount" }, fn: "updateExpenseForClient", expect: { expenseId: "e1", input: { annualAmount: 20 } } },
    { target: { kind: "savings_rule.create", input: { accountId: "a1" }, amountField: "annualAmount" }, fn: "createSavingsRuleForClient", expect: { input: { accountId: "a1" } } },
    { target: { kind: "savings_rule.update", ruleId: "r1", patch: { annualAmount: 30 }, amountField: "annualAmount" }, fn: "updateSavingsRuleForClient", expect: { ruleId: "r1", input: { annualAmount: 30 } } },
    { target: { kind: "deduction.create", amountField: "annualAmount", input: { type: "charitable", name: "Giving", owner: "joint", annualAmount: 5_000, growthRate: 0, startYear: 2026, endYear: 2060 } }, fn: "createDeductionForReturn", expect: { input: expect.objectContaining({ annualAmount: 5_000 }) } },
    { target: { kind: "deduction.update", deductionId: "d1", patch: { annualAmount: 7_000 }, amountField: "annualAmount" }, fn: "updateDeductionAmount", expect: { deductionId: "d1", annualAmount: 7_000 } },
    { target: { kind: "entity.create", input: { name: "Acme LLC", entityType: "partnership", taxTreatment: "qbi", value: 0 } }, fn: "createEntityForReturn", expect: { input: expect.objectContaining({ name: "Acme LLC" }) } },
    { target: { kind: "entity.update", entityId: "en1", patch: { taxTreatment: "qbi" } }, fn: "updateEntityTaxTreatment", expect: { entityId: "en1", taxTreatment: "qbi" } },
    { target: { kind: "plan_settings.update", patch: { residenceState: "PA" } }, fn: "updatePlanSettingsForReturn", expect: { patch: { residenceState: "PA" } } },
    { target: { kind: "client.update", patch: { filingStatus: "married_joint" } }, fn: "updateClientFilingStatus", expect: { filingStatus: "married_joint" } },
    { target: { kind: "medicare.upsert", owner: "spouse", priorYearMagi: 192_000, amountField: "priorYearMagi" }, fn: "upsertMedicarePriorYearMagi", expect: { owner: "spouse", priorYearMagi: 192_000 } },
  ];

  it.each(cases)("routes $target.kind to $fn and to nothing else", async ({ target, fn, expect: expected, txn }) => {
    vi.clearAllMocks();
    for (const f of Object.values(WRITERS)) f.mockResolvedValue({ ok: true, data: { id: "new" }, resourceId: "new" });
    const s = base({ id: "t", action: { label: "", describe: "", amountEditable: false, defaultAmount: null, target } });
    m.computeReconciliation.mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon([s]) });

    const r = await applySuggestion(args({ suggestionId: "t" }));

    expect(r.ok).toBe(true);
    expect(WRITERS[fn]).toHaveBeenCalledTimes(1);
    expect(WRITERS[fn]).toHaveBeenCalledWith(expect.objectContaining(expected));
    for (const [name, f] of Object.entries(WRITERS)) if (name !== fn) expect(f).not.toHaveBeenCalled();
    // Only the Social Security claim writes more than one row, so only it opens a transaction.
    expect(m.transaction).toHaveBeenCalledTimes(txn ? 1 : 0);
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ kind: target.kind }) }));
  });

  it("stamps cross-firm metadata from the GATE's access, never the caller's word for it", async () => {
    m.requireClientEditAccess.mockResolvedValue({ firmId: "org_1", access: "shared", client: {} });
    // A body claiming "own" must not be able to strip the cross-firm stamp off the audit.
    const r = await applySuggestion({ ...args({ callerOrgId: "org_other" }), access: "own" } as never);
    expect(r.ok).toBe(true);
    const meta = { crossFirmActor: true, actorFirmId: "org_other", taxYear: 2025, suggestionId: "income.wages.w2.0.create" };
    expect(m.createIncomeForClient).toHaveBeenCalledWith(expect.objectContaining({ crossFirmMeta: meta }));
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining(meta) }));
  });

  it("leaves the stamp off when the gate says the client is the caller's own", async () => {
    const r = await applySuggestion({ ...args({ callerOrgId: "org_other" }), access: "shared" } as never);
    expect(r.ok).toBe(true);
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.not.objectContaining({ crossFirmActor: true }) }));
  });

  it("refuses a Social Security claim whose chosen owner has no row", async () => {
    const oneRow = base({ id: "income.socialSecurity", action: { label: "", describe: "", amountEditable: true, defaultAmount: 40_000, ownerChoices: ["client", "spouse"],
      target: { kind: "income.socialSecurity.claim", amount: 40_000, rows: [{ owner: "client", incomeId: "s1", patch: {} }] } } });
    m.computeReconciliation.mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon([oneRow]) });
    expect(await applySuggestion(args({ suggestionId: "income.socialSecurity", owner: "spouse" }))).toMatchObject({ ok: false, status: 400 });
    expect(m.updateIncomeForClient).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
