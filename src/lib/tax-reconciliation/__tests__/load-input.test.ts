import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { clients } from "@/db/schema";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { ClientNotFoundError, ProjectionInputError } from "@/lib/projection/load-client-data";

const m = vi.hoisted(() => ({
  getTaxReturn: vi.fn(), loadDocumentContext: vi.fn(), loadEffectiveTree: vi.fn(), runProjectionWithEvents: vi.fn(),
  loadAnalysisContext: vi.fn(), listDismissedIds: vi.fn(), deductionsWhere: vi.fn(), scenarioWhere: vi.fn(),
  clientWhere: vi.fn(), runCalc: vi.fn(),
}));
vi.mock("@/lib/tax-returns/store", () => ({ getTaxReturn: m.getTaxReturn }));
vi.mock("@/lib/tax-returns/assemble-analysis", () => ({ loadDocumentContext: m.loadDocumentContext }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: m.loadEffectiveTree }));
vi.mock("@/engine", () => ({ runProjectionWithEvents: m.runProjectionWithEvents }));
vi.mock("@/lib/tax-returns/load-analysis-context", () => ({ loadAnalysisContext: m.loadAnalysisContext }));
vi.mock("../dismissals-store", () => ({ listDismissedIds: m.listDismissedIds }));
// Kept REAL by default (see beforeEach) so the state-tax and FICA figures below are the calculator's
// own; only the throw test replaces it, because no facts that survive `parseRowFacts` can break it.
vi.mock("@/lib/tax-analysis/adapter", async (importOriginal) => ({ ...(await importOriginal<object>()), runCalc: m.runCalc }));
// Three tables reach this mock. Discriminated on a column only that table carries — `scenarios`
// has isBaseCase, `clients` has firmId, `client_deductions` has neither — and each arm is pinned by
// a test below, so a mis-routed query shows up as a wrong VALUE rather than as a silent pass.
vi.mock("@/db", () => ({ db: { select: () => ({ from: (t: object) => ({ where: t && "isBaseCase" in t ? m.scenarioWhere : t && "firmId" in t ? m.clientWhere : m.deductionsWhere }) }) } }));

import { loadReconciliationInput, PROJECTION_FAILED_NOTE } from "../load-input";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025 } from "@/lib/tax-analysis/__tests__/fixtures";

const { runCalc: realRunCalc } = await vi.importActual<typeof import("@/lib/tax-analysis/adapter")>("@/lib/tax-analysis/adapter");

const tree = { client: { dateOfBirth: "1960-04-02", spouseDob: null, filingStatus: "single" }, planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.03, residenceState: "PA" }, incomes: [], expenses: [], savingsRules: [], accounts: [], entities: [], familyMembers: [], medicareCoverage: [] };
const row = (status = "ready") => ({ id: "tr-1", clientId: "c1", taxYear: 2025, status, facts: emptyTaxReturnFacts(2025), extractedFacts: null, warnings: [] });

/** A PA single filer with $100,000 of wages: state tax and FICA are both non-zero,
 *  which is what separates "the calculator ran" from "the calculator returned null". */
const paSingleFiler = () => {
  const f = emptyTaxReturnFacts(2025);
  f.filingStatus = "single";
  f.residenceState = "PA";
  f.income.wages = 100_000;
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getTaxReturn.mockResolvedValue(row());
  // The `full_return` summary carries a stray pair on purpose: only W-2 documents may
  // contribute W-2 pairs, and a filter that let any other role through would double-count
  // the same employer against the wages rule.
  m.loadDocumentContext.mockResolvedValue({ summaries: [{ id: "d1", role: "w2", w2s: [{ employer: "Acme", wages: 100_000 }] }, { id: "d2", role: "full_return", w2s: [{ employer: "Acme", wages: 100_000 }] }], unavailable: false });
  m.loadEffectiveTree.mockResolvedValue({ effectiveTree: tree });
  m.runProjectionWithEvents.mockReturnValue({ years: [{ year: 2026, income: { bySource: {} } }, { year: 2027 }] });
  m.loadAnalysisContext.mockResolvedValue({ resolver: createTaxResolver([params2025], { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 }), primaryAge: 65, spouseAge: null });
  m.listDismissedIds.mockResolvedValue({ ok: true, ids: new Set(["tax.federal"]) });
  m.clientWhere.mockResolvedValue([{ id: "c1" }]);
  m.runCalc.mockImplementation(realRunCalc);
  m.scenarioWhere.mockResolvedValue([{ id: "sc-base" }]);
  m.deductionsWhere.mockResolvedValue([]);
});

describe("loadReconciliationInput", () => {
  it("picks the plan year (taxYear when covered, else planStartYear), flattens W-2s, reads dismissals", async () => {
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    if (!r.ok) throw new Error(r.code);
    expect(r.input.planYear).toBe(2026);
    expect(r.input.engineYear?.year).toBe(2026);
    expect(r.input.w2s).toEqual([{ employer: "Acme", wages: 100_000 }]);
    expect(r.input.clientId).toBe("c1");
    expect(r.input.taxYear).toBe(2025);
    expect(r.taxReturnId).toBe("tr-1");
    expect(r.status).toBe("ready");
    expect(r.notes).toEqual([]);
    expect(r.dismissedIds).toEqual(new Set(["tax.federal"]));
    expect(r.dismissalsUnavailable).toBe(false);
    expect(m.loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "base", {});
    const later = await loadReconciliationInput("c1", "org_1", 2027);
    expect(later.ok && later.input.planYear).toBe(2027);
    expect(later.ok && later.input.engineYear?.year).toBe(2027);
  });

  it("narrows the tree onto the input's plan snapshot", async () => {
    m.loadEffectiveTree.mockResolvedValueOnce({ effectiveTree: { ...tree, incomes: [{ id: "i1", type: "salary", name: "Acme", annualAmount: 150_000, startYear: 2026, endYear: 2040, growthRate: 0.03, owner: "client" }] } });
    m.deductionsWhere.mockResolvedValueOnce([{ id: "d1", type: "charitable", name: "Church", annualAmount: "2000.00", growthRate: "0.0000", startYear: 2026, endYear: 2060 }]);
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    if (!r.ok) throw new Error(r.code);
    expect(r.input.plan.planSettings).toEqual({ planStartYear: 2026, planEndYear: 2060, inflationRate: 0.03, residenceState: "PA", capitalLossCarryforwardLt: null, capitalLossCarryforwardSt: null });
    expect(r.input.plan.incomes.map((i) => i.id)).toEqual(["i1"]);
    // The decimal columns arrive as strings; a rule comparing them numerically would
    // silently compare "2000.00" against a number and never fire.
    expect(r.input.plan.deductions).toEqual([{ id: "d1", type: "charitable", name: "Church", annualAmount: 2_000, growthRate: 0, startYear: 2026, endYear: 2060 }]);
  });

  it("reads deductions from the base-case scenario only, and none when there is no base case", async () => {
    m.scenarioWhere.mockResolvedValueOnce([]);
    m.deductionsWhere.mockResolvedValue([{ id: "d-other", type: "charitable", name: "Other scenario", annualAmount: "9000.00", growthRate: "0.0000", startYear: 2026, endYear: 2060 }]);
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    expect(r.ok && r.input.plan.deductions).toEqual([]);
    expect(m.deductionsWhere).not.toHaveBeenCalled();
  });

  it("returns not_found / facts_unreadable / no_plan", async () => {
    m.getTaxReturn.mockResolvedValueOnce(null);
    const missing = await loadReconciliationInput("c1", "org_1", 2025);
    expect(missing).toMatchObject({ ok: false, code: "not_found" });
    expect(missing.ok === false && missing.message).toBe("No 2025 return on file.");

    m.getTaxReturn.mockResolvedValueOnce({ ...row(), facts: { taxYear: "nope" } });
    const unreadable = await loadReconciliationInput("c1", "org_1", 2025);
    expect(unreadable).toMatchObject({ ok: false, code: "facts_unreadable" });
    expect(unreadable.ok === false && unreadable.message).toBe("The 2025 return's facts couldn't be read. Open it on Tax Analysis to recover it.");

    m.loadEffectiveTree.mockRejectedValueOnce(new ProjectionInputError("Client c1 has no base case scenario"));
    const noPlan = await loadReconciliationInput("c1", "org_1", 2025);
    expect(noPlan).toMatchObject({ ok: false, code: "no_plan" });
    expect(noPlan.ok === false && noPlan.message).toBe("This household has no base-case plan to compare against yet.");
  });

  it("hides a client in another firm behind the same answer as one that does not exist", async () => {
    // `getTaxReturn` is scoped on clientId alone, so without the firm check first this function
    // would answer "this household exists and its return is still extracting" for any client in any
    // firm. Both the code AND the message have to match the missing-return answer, or the
    // difference is itself the oracle.
    m.clientWhere.mockResolvedValueOnce([]);
    const outOfFirm = await loadReconciliationInput("c1", "someone_elses_firm", 2025);
    expect(outOfFirm).toEqual({ ok: false, code: "not_found", message: "No 2025 return on file." });
    // The where-clause IS the control, and a mocked db cannot evaluate one — so pin the predicate
    // itself. Scoping on clientId alone builds a different object and reddens here.
    expect(m.clientWhere).toHaveBeenCalledWith(and(eq(clients.id, "c1"), eq(clients.firmId, "someone_elses_firm")));

    m.getTaxReturn.mockResolvedValueOnce(null);
    const missing = await loadReconciliationInput("c1", "org_1", 2025);
    expect(outOfFirm).toEqual(missing);

    // And the firm check runs BEFORE the return is read at all: a still-extracting return in
    // another firm must not leak its status either.
    // NB a persistent mock, not `...Once`: the firm check short-circuits before the return is read,
    // so a queued one-shot would survive this test and poison the next.
    m.clientWhere.mockResolvedValueOnce([]);
    m.getTaxReturn.mockResolvedValue({ ...row("extracting"), facts: null });
    expect(await loadReconciliationInput("c1", "someone_elses_firm", 2025)).toEqual(missing);
  });

  it("says the return is still being read when the extraction has not finished", async () => {
    // The most common way to reach the no-facts branch is a return uploaded moments ago:
    // `status` defaults to "extracting" and `facts` stays null until extraction lands.
    // Telling that advisor to "recover" a healthy return would be a lie.
    m.getTaxReturn.mockResolvedValueOnce({ ...row("extracting"), facts: null });
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    expect(r).toMatchObject({ ok: false, code: "facts_unreadable" });
    expect(r.ok === false && r.message).toBe("The 2025 return is still being read. Check back in a moment.");

    m.getTaxReturn.mockResolvedValueOnce({ ...row("failed"), facts: null });
    const failed = await loadReconciliationInput("c1", "org_1", 2025);
    expect(failed.ok === false && failed.message).toBe("The 2025 return's facts couldn't be read. Open it on Tax Analysis to recover it.");
  });

  it("maps a missing client to no_plan and lets any other tree-loader error through", async () => {
    m.loadEffectiveTree.mockRejectedValueOnce(new ClientNotFoundError("c1"));
    expect(await loadReconciliationInput("c1", "org_1", 2025)).toMatchObject({ ok: false, code: "no_plan" });

    m.loadEffectiveTree.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(loadReconciliationInput("c1", "org_1", 2025)).rejects.toThrow("connection terminated");
  });

  it("degrades to engineYear null with a note when the projection throws or the year is outside the plan", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.runProjectionWithEvents.mockImplementationOnce(() => { throw new Error("boom"); });
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    expect(r.ok && r.input.engineYear).toBeNull();
    expect(r.ok && r.notes[0]).toMatch(/projection couldn't run/);
    expect(r.ok && r.notes).toEqual([PROJECTION_FAILED_NOTE]);
    warn.mockRestore();

    const far = await loadReconciliationInput("c1", "org_1", 2099);
    expect(far.ok && far.input.engineYear).toBeNull();
    expect(far.ok && far.input.planYear).toBe(2099);
    expect(far.ok && far.notes).toEqual(["The plan ends in 2060, so it has no 2099 figures to compare against and only direct row comparisons are shown."]);
  });

  it("treats the plan's final year as covered and the year after it as past the plan", async () => {
    // The 2099 case above sits nowhere near the boundary, so it would pass just as happily
    // against an off-by-one. These two sit either side of planEndYear.
    m.runProjectionWithEvents.mockReturnValueOnce({ years: [{ year: 2060 }] });
    const last = await loadReconciliationInput("c1", "org_1", 2060);
    expect(last.ok && last.input.engineYear?.year).toBe(2060);
    expect(last.ok && last.notes).toEqual([]);

    const past = await loadReconciliationInput("c1", "org_1", 2061);
    expect(past.ok && past.input.engineYear).toBeNull();
    expect(past.ok && past.notes).toEqual(["The plan ends in 2060, so it has no 2061 figures to compare against and only direct row comparisons are shown."]);
  });

  it("degrades with the projection note when the run succeeds but has no row for the plan year", async () => {
    m.runProjectionWithEvents.mockReturnValueOnce({ years: [{ year: 2030 }] });
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    expect(r.ok && r.input.engineYear).toBeNull();
    expect(r.ok && r.notes).toEqual([PROJECTION_FAILED_NOTE]);
  });

  it("degrades both estimates to zero rather than failing the page when the tax calculator throws", async () => {
    // These facts come off scanned PDFs and reach a full tax calculation. The estimates are
    // secondary and already have a defined zero fallback, so a throw must not 500 the whole page.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.runCalc.mockImplementationOnce(() => { throw new Error("bad bracket table"); });
    m.getTaxReturn.mockResolvedValueOnce({ ...row(), facts: paSingleFiler() });
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    expect(r.ok).toBe(true);
    expect(r.ok && r.input.stateTaxEstimate).toBe(0);
    expect(r.ok && r.input.ficaEstimate).toBe(0);
    // Everything else still loaded — the degrade is confined to the two estimates.
    expect(r.ok && r.input.engineYear?.year).toBe(2026);
    expect(r.ok && r.notes).toEqual([]);
    warn.mockRestore();
  });

  it("names the plan year in the plan-end note, not the return's year", async () => {
    // A plan whose end age sits below the client's current age ends BEFORE it starts. planYear is
    // clamped up to planStartYear, so the two diverge — and the old wording read "the plan ends in
    // 2025, before the 2025 return's year", which contradicts itself.
    m.loadEffectiveTree.mockResolvedValueOnce({ effectiveTree: { ...tree, planSettings: { ...tree.planSettings, planStartYear: 2026, planEndYear: 2025 } } });
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    expect(r.ok && r.input.planYear).toBe(2026);
    expect(r.ok && r.input.engineYear).toBeNull();
    expect(r.ok && r.notes).toEqual(["The plan ends in 2025, so it has no 2026 figures to compare against and only direct row comparisons are shown."]);
  });

  it("marks dismissals unavailable in the migration window and estimates state tax and FICA from the facts", async () => {
    m.listDismissedIds.mockResolvedValueOnce({ ok: false, unavailable: true });
    m.getTaxReturn.mockResolvedValueOnce({ ...row(), facts: paSingleFiler() });
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    expect(r.ok && r.dismissalsUnavailable).toBe(true);
    expect(r.ok && r.dismissedIds).toEqual(new Set());
    expect(r.ok && r.input.stateTaxEstimate).toBeGreaterThan(0);
    // PA flat 3.07% of $100,000 wages.
    expect(r.ok && r.input.stateTaxEstimate).toBeCloseTo(3_070, 0);
    // Employee Social Security (6.2%) + Medicare (1.45%) on $100,000 of wages. Line 24
    // excludes it, so without it the spending rule would treat $7,650 the household
    // never saw as money available to spend.
    expect(r.ok && r.input.ficaEstimate).toBeCloseTo(7_650, 0);
  });

  it("falls back to zero estimates when the return's filing status is unknown", async () => {
    // runCalc refuses to guess a bracket, so it returns null — both estimates must be 0
    // rather than NaN or undefined.
    const r = await loadReconciliationInput("c1", "org_1", 2025);
    expect(r.ok && r.input.facts.filingStatus).toBeNull();
    expect(r.ok && r.input.stateTaxEstimate).toBe(0);
    expect(r.ok && r.input.ficaEstimate).toBe(0);
  });
});
