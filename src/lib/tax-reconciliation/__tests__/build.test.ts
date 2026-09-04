import { afterEach, describe, it, expect, vi } from "vitest";
import { emptyBusiness, emptyTaxReturnFacts, type TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { buildReconciliation, type BuildContext } from "../build";
import type { EngineYear, Reconciliation } from "../types";
import { engineYearFixture, inputFixture, planFixture } from "./fixtures";

// `over` is typed rather than an untyped bag: a misspelled key would otherwise be swallowed and the
// test would think it was pinning a context field while the default stayed in place.
const ctx = (over: Partial<BuildContext> = {}): BuildContext =>
  ({ status: "ready", dismissedIds: new Set<string>(), dismissalsUnavailable: false, notes: [], ...over });

/** A single PA filer against the married-filing-jointly PA plan fixture, which carries no rows at
 *  all. Chosen so three DIFFERENT rules reach three different sections: household (filing status,
 *  Medicare MAGI), income (wages, pensions) and tax (the balance due). */
const facts = (): TaxReturnFacts => {
  const f = emptyTaxReturnFacts(2025);
  f.filingStatus = "single";
  f.residenceState = "PA";
  f.income.wages = 80_000;
  f.income.pensionsGross = 24_000;
  f.income.agi = 104_000;
  f.income.totalIncome = 104_000;
  f.tax.totalTax = 15_000;
  f.payments.amountOwed = 9_000;
  return f;
};

/** Stated in 2026 dollars: at the fixture's 3% inflation, 107,120 deflates to exactly 104,000 and
 *  `federalTax` to a hundredth of itself over 1.03, so every expectation below reads in 2025 dollars. */
const engine = (federalTax: number): EngineYear =>
  engineYearFixture({ taxResult: { income: { totalIncome: 107_120 }, flow: { adjustedGrossIncome: 107_120, totalFederalTax: federalTax } } as never });

/** Section id, title and the ids it carries — one assertion that pins grouping, ordering, titles and
 *  membership together, so a swapped section or a lost item cannot hide behind a matching count. */
const grouped = (r: Reconciliation) => r.sections.map((s) => [s.id, s.title, s.items.map((i) => i.id)]);

/** The deflation note the builder appends whenever the plan year is not the tax year. */
/** `notes` carries only what the PAGE cannot know for itself — a rule that
 *  threw, a projection that did not run. The units the plan figures are stated
 *  in are not one of those: the renderer labels its own columns and explains
 *  the restatement on the overview strip, so a units note here printed the same
 *  sentence twice, one line apart, in different words. */
const UNITS_SENTENCE = /shown in 2025 dollars|restated in 2025 dollars/;

describe("buildReconciliation", () => {
  // Restored here rather than at the end of the two tests that spy on console.error, so a failing
  // assertion cannot leak the spy into the rest of the file.
  afterEach(() => { vi.restoreAllMocks(); });

  it("groups open items by section in SECTION_ORDER, dropping the sections no rule reached", () => {
    const r = buildReconciliation(inputFixture({ facts: facts() }), ctx());
    // The rules run household-first (see RULES), so a builder that grouped in emission order would
    // read household, income, tax. SECTION_ORDER puts income first — deleting the ordering reddens.
    // The four absent sections pin the empty-section drop: keep every section and this reddens too.
    expect(grouped(r)).toEqual([
      ["income", "Income", ["income.wages.total.create", "income.pensions.create"]],
      ["household", "Household & assumptions", ["household.filingStatus", "medicare.priorYearMagi.client"]],
      ["tax", "Why the tax differs", ["tax.settlement"]],
    ]);
    expect(r.sections.flatMap((s) => s.items).map((i) => i.status)).toEqual(["open", "open", "open", "open", "open"]);
    expect(r.overview).toMatchObject({ openCount: 5, dismissedCount: 0 });
  });

  it("keeps a dismissed suggestion computed but out of the sections and the open count", () => {
    const r = buildReconciliation(inputFixture({ facts: facts() }), ctx({ dismissedIds: new Set(["income.pensions.create"]) }));
    expect(grouped(r)).toEqual([
      ["income", "Income", ["income.wages.total.create"]],
      ["household", "Household & assumptions", ["household.filingStatus", "medicare.priorYearMagi.client"]],
      ["tax", "Why the tax differs", ["tax.settlement"]],
    ]);
    expect(r.dismissed.map((d) => d.id)).toEqual(["income.pensions.create"]);
    // Dismissed means routed and re-stamped, not skipped: the card is fully built, action included,
    // so the UI can show what was set aside. Only `status` differs from the open form.
    expect(r.dismissed[0]).toMatchObject({
      id: "income.pensions.create", section: "income", kind: "update", status: "dismissed",
      returnFigure: { label: "Pensions and annuities", amount: 24_000, display: "$24,000" },
      delta: { display: "Not in the plan", tone: "missing" },
    });
    expect(r.dismissed[0].action?.target).toMatchObject({ kind: "income.create" });
    expect(r.overview).toMatchObject({ openCount: 4, dismissedCount: 1 });
  });

  it("drops a section once every item in it is dismissed", () => {
    const r = buildReconciliation(inputFixture({ facts: facts() }), ctx({ dismissedIds: new Set(["income.wages.total.create", "income.pensions.create"]) }));
    expect(r.sections.map((s) => s.id)).toEqual(["household", "tax"]);
    expect(r.dismissed.map((d) => d.id)).toEqual(["income.wages.total.create", "income.pensions.create"]);
    expect(r.overview).toMatchObject({ openCount: 3, dismissedCount: 2 });
  });

  it("matches a dismissal on the whole id, so a create arm's prefix does not silence it", () => {
    // Every create arm carries a `.create` suffix precisely so dismissing "add this business" does
    // not also dismiss "this business's amount is off". Matching on a prefix would collapse the two.
    const f = facts();
    f.businesses = [{ ...emptyBusiness(), name: "Acme Consulting", netProfit: 40_000 }];
    const prefix = buildReconciliation(inputFixture({ facts: f }), ctx({ dismissedIds: new Set(["business.scheduleC.0"]) }));
    expect(prefix.sections.find((s) => s.id === "business")!.items.map((i) => i.id)).toEqual(["business.scheduleC.0.create"]);
    expect(prefix.dismissed).toEqual([]);

    const whole = buildReconciliation(inputFixture({ facts: f }), ctx({ dismissedIds: new Set(["business.scheduleC.0.create"]) }));
    expect(whole.sections.map((s) => s.id)).toEqual(["income", "household", "tax"]);
    expect(whole.dismissed.map((d) => d.id)).toEqual(["business.scheduleC.0.create"]);
  });

  it("emits every suggestion id once", () => {
    const r = buildReconciliation(inputFixture({ facts: facts(), engineYear: engine(15_450) }), ctx());
    const all = [...r.sections.flatMap((s) => s.items), ...r.dismissed].map((i) => i.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("fills the overview from the engine year, deflated, and lists what already agrees", () => {
    const r = buildReconciliation(inputFixture({ facts: facts(), engineYear: engine(15_450) }), ctx());
    // The engine-present grouping, which the engineYear-null fixtures cannot reach: an engine year
    // wakes the spending rule, so `spending.implied` has to route to its own section and land
    // between income and household. It also proves no engine-fed card renders a NaN — the fixture's
    // `taxResult` carries three fields, so a rule reading a fourth would surface here.
    expect(grouped(r)).toEqual([
      ["income", "Income", ["income.wages.total.create", "income.pensions.create"]],
      ["spending", "Spending", ["spending.implied"]],
      ["household", "Household & assumptions", ["household.filingStatus", "medicare.priorYearMagi.client"]],
      ["tax", "Why the tax differs", ["tax.settlement"]],
    ]);
    const displays = r.sections.flatMap((s) => s.items).flatMap((i) => [i.returnFigure.display, i.planFigure.display, i.delta.display, i.headline, i.meaning]);
    expect(displays.filter((d) => d.includes("NaN"))).toEqual([]);
    expect(r.overview.totalIncome).toEqual({ return: 104_000, plan: expect.closeTo(104_000, 0) });
    expect(r.overview.agi).toEqual({ return: 104_000, plan: expect.closeTo(104_000, 0) });
    expect(r.overview.federalTax).toEqual({ return: 15_000, plan: expect.closeTo(15_000, 0) });
    expect(r.overview.effectiveRate.return).toBeCloseTo(15_000 / 104_000, 6);
    expect(r.overview.effectiveRate.plan).toBeCloseTo(15_000 / 104_000, 6);
    // The checks are the rules' own output, not a restatement of the count: PA matches PA, and the
    // engine's federal tax deflates onto the return's, so exactly these two rows agree.
    expect(r.checks).toEqual([
      { id: "household.residenceState", label: "Residence state", returnDisplay: "PA", planDisplay: "PA" },
      { id: "tax.federal", label: "Federal tax", returnDisplay: "$15,000", planDisplay: "$15,000" },
    ]);
    expect(r.overview.inLineCount).toBe(2);
  });

  it("counts one more in-line comparison when one more row agrees", () => {
    // Same fixture, filed jointly like the plan: household.filingStatus moves from a suggestion to a
    // check. A count wired to anything but the checks the rules produced cannot follow that.
    const f = facts();
    f.filingStatus = "married_joint";
    const r = buildReconciliation(inputFixture({ facts: f, engineYear: engine(15_450) }), ctx());
    expect(r.checks.map((c) => c.id)).toEqual(["household.filingStatus", "household.residenceState", "tax.federal"]);
    expect(r.overview.inLineCount).toBe(3);
    expect(r.sections.flatMap((s) => s.items).map((i) => i.id)).not.toContain("household.filingStatus");
  });

  it("degrades to row-level rules with the caller's note when the engine year is null, and adds no note of its own", () => {
    const r = buildReconciliation(inputFixture({ facts: facts() }), ctx({ notes: ["The plan's projection couldn't run, so only direct row comparisons are shown."] }));
    // Exactly one note: the caller's degrade note passes through once, and no rule
    // adds its own. The builder appends nothing — units are the renderer's to state.
    expect(r.notes).toEqual(["The plan's projection couldn't run, so only direct row comparisons are shown."]);
    expect(r.overview.agi.plan).toBeNull();
    expect(r.overview.totalIncome.plan).toBeNull();
    expect(r.overview.federalTax.plan).toBeNull();
    expect(r.overview.effectiveRate.plan).toBeNull();
    expect(r.checks.map((c) => c.id)).not.toContain("tax.federal");
    // Ruled, not a bug: a refund or balance due is a pure return-side fact whose plan side is "pays
    // as it goes", so the settlement card renders beside the degrade note.
    expect(r.sections.find((s) => s.id === "tax")!.items.map((i) => i.id)).toEqual(["tax.settlement"]);
  });

  it("states the units nowhere in notes, whether or not the plan year is the tax year", () => {
    // Both arms: a units note used to appear only when the years differed, so
    // pinning just one arm would let it come back for the other.
    for (const planYear of [2025, 2026]) {
      const r = buildReconciliation(inputFixture({ facts: facts(), planYear }), ctx({ notes: ["Only direct row comparisons are shown."] }));
      expect(r.notes).toEqual(["Only direct row comparisons are shown."]);
      expect(r.notes.join(" ")).not.toMatch(UNITS_SENTENCE);
    }
  });

  it("runs the federal-tax rule last, so it names the largest income-side gaps the other rules found", () => {
    // The plan computes 25,000 of federal tax against the return's 15,000 — past the rule's gap
    // gates, so the explaining arm fires. It can only name these three because every other rule has
    // already run and its suggestions were handed over; run it first (or hand it nothing) and the
    // sentence disappears. Largest first, so a lost ordering reddens rather than reshuffling quietly.
    const r = buildReconciliation(inputFixture({ facts: facts(), engineYear: engine(25_750) }), ctx());
    expect(r.sections.find((s) => s.id === "tax")!.items.map((i) => i.id)).toEqual(["tax.federal", "tax.settlement"]);
    const card = r.sections.find((s) => s.id === "tax")!.items[0];
    expect(card.meaning).toContain(
      "Where the difference comes from: Available to spend (cash in − taxes − retirement savings) (not in the plan); Wages (not in the plan); Pensions and annuities (not in the plan).",
    );
    expect(r.checks.map((c) => c.id)).toEqual(["household.residenceState"]);
  });

  it("keeps every other rule's cards when one rule throws, and names the checks that went missing", () => {
    // `plan.medicare` is read by exactly ONE rule (assumptions), so nulling it fails that rule alone
    // — a real throw down the real loop rather than a mocked barrel. The Medicare MAGI card is the
    // only thing that disappears: the household section still renders the filing-status card, which
    // a different rule put there, so the page degrades card-by-card and not section-by-section.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = buildReconciliation(inputFixture({ facts: facts(), plan: { ...planFixture(), medicare: null as never } }), ctx());
    expect(grouped(r)).toEqual([
      ["income", "Income", ["income.wages.total.create", "income.pensions.create"]],
      ["household", "Household & assumptions", ["household.filingStatus"]],
      ["tax", "Why the tax differs", ["tax.settlement"]],
    ]);
    // Disclosed, never swallowed: the note names what went unchecked, and the error reaches the logs.
    expect(r.notes).toEqual(["The assumption checks could not run, so nothing on this page reflects them. Everything else was compared normally."]);
    expect(spy).toHaveBeenCalledOnce();
    // The counts follow the cards that survived, so a rule that throws cannot inflate them.
    expect(r.overview).toMatchObject({ openCount: 4, dismissedCount: 0, inLineCount: 1 });
  });

  it("catches the federal-tax rule too, which runs outside the loop", () => {
    // `facts.payments` is read by exactly ONE rule (tax), and with no engine year that rule's other
    // arm is skipped — so the whole tax section goes and nothing else moves.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = buildReconciliation(inputFixture({ facts: { ...facts(), payments: null as never } }), ctx());
    expect(grouped(r)).toEqual([
      ["income", "Income", ["income.wages.total.create", "income.pensions.create"]],
      ["household", "Household & assumptions", ["household.filingStatus", "medicare.priorYearMagi.client"]],
    ]);
    expect(r.notes).toEqual(["The federal tax checks could not run, so nothing on this page reflects them. Everything else was compared normally."]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("passes taxYear/planYear/planStartYear/status/dismissalsUnavailable through", () => {
    const r = buildReconciliation(inputFixture({ facts: facts() }), ctx({ status: "needs_review", dismissalsUnavailable: true }));
    expect(r).toMatchObject({ taxYear: 2025, planYear: 2026, planStartYear: 2026, status: "needs_review", dismissalsUnavailable: true });
  });
});
