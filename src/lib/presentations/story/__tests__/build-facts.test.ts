import { describe, it, expect } from "vitest";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { ChangeRow } from "@/lib/presentations/pages/scenario-changes/types";
import { describeChange } from "@/lib/presentations/pages/scenario-changes/describe";
import {
  buildResolveContext,
  EMPTY_RESOLVE_DATA,
} from "@/lib/presentations/pages/scenario-changes/describe/resolve";
import { buildStoryFacts, groupStrategies, type StoryFactsInput } from "../build-facts";
import { factDisplaySet } from "../facts";
import { extractFigures, validateFacts } from "../validate/facts";
import { narrateWhatWeRecommend } from "../chapters/what-we-recommend";
import { factsForChapter, type StoryContext, type StoryStrategy } from "../types";

const input: StoryFactsInput = {
  todayAssets: 2_400_000,
  todayDebts: 300_000,
  todayLiquid: 1_500_000,
  baseSuccess: 0.73,
  proposedSuccess: 0.91,
  baseEndLiquid: 900_000,
  proposedEndLiquid: 2_600_000,
  retirementYear: 2041,
  endOfLifeYear: 2065,
  strategies: [],
};

describe("buildStoryFacts", () => {
  it("emits stable ids for every headline figure", () => {
    const ids = buildStoryFacts(input).map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "today.assets",
        "today.debts",
        "today.netWorth",
        "today.liquid",
        "outcome.confidence.base",
        "outcome.confidence.proposed",
        "outcome.legacy.base",
        "outcome.legacy.proposed",
        "plan.retirementYear",
        "plan.endOfLifeYear",
      ]),
    );
  });

  it("derives net worth rather than taking it on trust", () => {
    const net = buildStoryFacts(input).find((f) => f.id === "today.netWorth");
    expect(net?.raw).toBe(2_100_000);
    expect(net?.display).toBe("$2.1M");
  });

  it("omits proposed figures when there is no proposal", () => {
    const ids = buildStoryFacts({ ...input, proposedSuccess: null, proposedEndLiquid: null }).map(
      (f) => f.id,
    );
    expect(ids).not.toContain("outcome.confidence.proposed");
    expect(ids).toContain("outcome.confidence.base");
  });

  it("omits confidence entirely when Monte Carlo is unavailable", () => {
    const ids = buildStoryFacts({ ...input, baseSuccess: null, proposedSuccess: null }).map(
      (f) => f.id,
    );
    expect(ids).not.toContain("outcome.confidence.base");
  });

  it("never emits duplicate ids", () => {
    const ids = buildStoryFacts({ ...input, strategies: STRATEGIES }).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Real `describeChange` output. Invented rows would prove nothing here: the
// whole point is that the figures are spelled by a formatter this module does
// not own. Each entry is a change shape the app actually writes.
// ---------------------------------------------------------------------------

const DESCRIBE_CTX = {
  targetNames: {
    "savings_rule:s1": "401(k) contribution",
    "income:i1": "Alan's Social Security",
    "roth_conversion:r1": "Roth ladder",
    "liability:l1": "Beach house mortgage",
    "account:a1": "Joint brokerage",
    "expense:e1": "Travel",
    "gift:g1": "Gift to Maya",
    "client:c1": "Client profile",
    "asset_transaction:t1": "Sell the rental",
    "reinvestment:v1": "Reinvestment 2030",
  },
  resolve: buildResolveContext({
    ...EMPTY_RESOLVE_DATA,
    accountsById: {
      acc1: { id: "acc1", name: "Traditional IRA", category: "retirement" },
      acc2: { id: "acc2", name: "Roth IRA", category: "retirement" },
    } as never,
  }),
};

const change = (o: Partial<ScenarioChange>): ScenarioChange => ({
  id: "x",
  scenarioId: "sc",
  opType: "add",
  targetKind: "income",
  targetId: "i1",
  payload: {},
  toggleGroupId: null,
  orderIndex: 0,
  ...o,
});

/** [strategy name, the change the app writes] — one per describer path. */
const REAL_CHANGES: Array<[string, ScenarioChange]> = [
  ["Boost the 401(k)", change({ targetKind: "savings_rule", targetId: "s1", opType: "edit",
    payload: { annualAmount: { from: 20_000, to: 25_000 }, rothPercent: { from: 0, to: 0.5 } } })],
  ["Raise the contribution", change({ targetKind: "savings_rule", targetId: "s1", opType: "edit",
    payload: { annualAmount: { from: 20_000, to: 25_000 } } })],
  ["Start saving to the IRA", change({ targetKind: "savings_rule", targetId: "s1", opType: "add",
    payload: { accountId: "acc1", annualAmount: 25_000, rothPercent: 0.5, startYear: 2026, endYear: 2035 } })],
  ["Add Alan's Social Security", change({ targetKind: "income", targetId: "i1", opType: "add",
    payload: { type: "social_security", annualAmount: 48_000, owner: "client", startYear: 2041, endYear: 2065 } })],
  ["Delay Social Security", change({ targetKind: "income", targetId: "i1", opType: "edit",
    payload: { claimAge: { from: 67, to: 70 } } })],
  ["Roth ladder", change({ targetKind: "roth_conversion", targetId: "r1", opType: "add",
    payload: { conversionType: "fixed_amount", fixedAmount: 50_000, sourceAccountIds: ["acc1"],
      destinationAccountId: "acc2", startYear: 2028, endYear: 2033 } })],
  ["Take the mortgage", change({ targetKind: "liability", targetId: "l1", opType: "add",
    payload: { balance: 300_000, interestRate: 0.045, monthlyPayment: 1_800 } })],
  ["Retune the brokerage", change({ targetKind: "account", targetId: "a1", opType: "edit",
    payload: { growthRate: { from: 0.065, to: 0.045 }, value: { from: 500_000, to: 600_000 } } })],
  ["Spend more on travel", change({ targetKind: "expense", targetId: "e1", opType: "edit",
    payload: { annualAmount: { from: 100_000, to: 150_000 } } })],
  ["Add the travel budget", change({ targetKind: "expense", targetId: "e1", opType: "add",
    payload: { type: "living", annualAmount: 96_000, startYear: 2026, endYear: 2040 } })],
  ["Gift to Maya", change({ targetKind: "gift", targetId: "g1", opType: "add",
    payload: { amount: 18_000, year: 2027, recipientFamilyMemberId: "fm1" } })],
  ["Retire at 62", change({ targetKind: "client", targetId: "c1", opType: "edit",
    payload: { retirementAge: { from: 65, to: 62 } } })],
  ["Sell the rental", change({ targetKind: "asset_transaction", targetId: "t1", opType: "add",
    payload: { type: "sell", accountId: "acc1", year: 2029, overrideSaleValue: 850_000, fractionSold: 0.5 } })],
  ["Move to the model portfolio", change({ targetKind: "reinvestment", targetId: "v1", opType: "add",
    payload: { year: 2030, accountIds: ["acc1"], customGrowthRate: "0.062", realizeTaxesOnSwitch: false } })],
  ["Lift the employer match", change({ targetKind: "savings_rule", targetId: "s1", opType: "edit",
    payload: { employerMatchLimit: { from: 0.06, to: 0.08 } } })],
  ["Trim the negative expense", change({ targetKind: "expense", targetId: "e1", opType: "edit",
    payload: { annualAmount: { from: -50_000, to: -20_000 }, startYear: { from: 2026, to: 2030 } } })],
];

const REAL_ROWS: Array<[string, ChangeRow]> = REAL_CHANGES.map(([name, c]) => [
  name,
  describeChange(c, DESCRIBE_CTX),
]);

const STRATEGIES: StoryStrategy[] = REAL_ROWS.map(([name, row]) => ({ name, rows: [row] }));

function contextFor(strategies: StoryStrategy[], packStrategies: StoryStrategy[]): StoryContext {
  return {
    household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
    scenarioLabel: "Retire at 62 + Roth",
    documentRole: "standalone",
    hasProposal: true,
    strategies,
    facts: buildStoryFacts({ ...input, strategies: packStrategies }),
  };
}

/** The predicate `what-we-recommend.ts` applies before it prints, stated from
 *  the outside: no ungrounded figure, and no figure in a foreign spelling. */
function ungroundedFigures(text: string, facts: StoryContext["facts"]): string[] {
  const spellings = factDisplaySet(facts);
  return [
    ...validateFacts(text, facts).map((f) => f.message),
    ...extractFigures(text).filter((figure) => !spellings.has(figure)),
  ];
}

const GENERIC_CLAUSE = /— this changes [^.]+\.$/u;

describe("the fact pack carries the strategies' own figures", () => {
  it("quotes each figure exactly as the change list spells it, and never reformats it", () => {
    // `compactCurrency` (the row) and `fmtUsdCompact` (this document) DISAGREE:
    // 20000 → "$20k" / "$20K", and 1500 → "$1.5k" / "$2K". Re-formatting a
    // quoted token would print a different number to a client.
    const row = REAL_ROWS[1][1];
    expect(row.detail[0]).toBe("Annual amount: $20k → $25k");

    const displays = factDisplaySet(buildStoryFacts({ ...input, strategies: [STRATEGIES[1]] }));
    expect(displays.has("$20k")).toBe(true);
    expect(displays.has("$25k")).toBe(true);
    expect(displays.has("$20K")).toBe(false);
    expect(displays.has("$25K")).toBe(false);
  });

  it("leaves a quoted figure's raw null rather than parsing the token back to a number", () => {
    const quoted = buildStoryFacts({ ...input, strategies: [STRATEGIES[1]] }).filter(
      (f) => f.display === "$20k",
    );
    expect(quoted).toHaveLength(1);
    expect(quoted[0].raw).toBeNull();
  });

  /**
   * The model is shown the pack as "- <label>: <display>". Two entries labelled
   * only "Raise the contribution", one reading $20k and one $25k, say nothing
   * about which is the before — and "we're bringing it down from $25k to $20k"
   * clears all four gates, because Gate 1 checks spelling and never meaning.
   */
  it("labels a quoted figure with the clause it came from, direction included", () => {
    const facts = buildStoryFacts({ ...input, strategies: [STRATEGIES[1]] });
    const labels = facts.filter((f) => f.raw === null).map((f) => f.label);
    expect(labels).toEqual([
      'Raise the contribution — from "Annual amount: $20k → $25k"',
      'Raise the contribution — from "Annual amount: $20k → $25k"',
    ]);
    expect(new Set(labels).size).toBe(1);
    // …and the clause states the direction the two bare amounts cannot.
    expect(labels[0]).toContain("$20k → $25k");
  });

  it("scopes every quoted figure to the recommendation chapter", () => {
    const facts = buildStoryFacts({ ...input, strategies: STRATEGIES });
    for (const f of facts.filter((x) => x.raw === null)) {
      expect(f.chapters).toEqual(["whatWeRecommend"]);
    }
    // …and leaves the plan-level totals unscoped, so they stay true everywhere.
    for (const f of facts.filter((x) => x.raw !== null)) {
      expect(f.chapters).toBeUndefined();
    }
  });

  it("keeps a proposed change's figures out of the chapter about today", () => {
    const facts = buildStoryFacts({ ...input, strategies: STRATEGIES });
    const forBalanceSheet = factsForChapter(facts, "whatYouHave").map((f) => f.display);
    expect(forBalanceSheet).toContain("$2.4M"); // a household total: true everywhere
    expect(forBalanceSheet).not.toContain("$850k"); // a future rental sale price
    expect(forBalanceSheet).not.toContain("$50k"); // a proposed Roth conversion
    expect(factsForChapter(facts, "whatYouHave")).toHaveLength(10);
    expect(factsForChapter(facts, "whatWeRecommend").length).toBeGreaterThan(10);
  });

  it("does not re-quote a figure the plan facts already spell that way", () => {
    // `plan.retirementYear` is 2041 and the income row's window is "2041–2065",
    // so both years are already in the pack under their own ids.
    const facts = buildStoryFacts({ ...input, strategies: [STRATEGIES[3]] });
    expect(facts.filter((f) => f.display === "2041")).toHaveLength(1);
    expect(facts.find((f) => f.display === "2041")?.id).toBe("plan.retirementYear");
  });

  /**
   * The one residual COST of quoting, pinned so it is a known trade and not a
   * later surprise: case. With debts of 20000 this document writes "$20K" and
   * the savings row writes the same dollars "$20k", so both spellings sit in one
   * pack.
   *
   * Accepted deliberately. Closing it means re-formatting the quoted token, and
   * `compactCurrency(1500)` is "$1.5k" where `fmtUsdCompact(1500)` is "$2K" — the
   * round trip would print a different NUMBER to the client, which is worse than
   * a different letter. Flagged for Dan; not fixable inside this module.
   */
  it("admits both spellings of one dollar amount — the accepted cost of quoting", () => {
    const facts = buildStoryFacts({ ...input, todayDebts: 20_000, strategies: [STRATEGIES[1]] });
    const displays = facts.map((f) => f.display);
    expect(displays).toContain("$20K"); // fmtUsdCompact — this document
    expect(displays).toContain("$20k"); // compactCurrency — the changes table
    expect(facts.find((f) => f.display === "$20K")?.id).toBe("today.debts");
  });

  /**
   * Nothing reads past `detail[0]`: `what-we-recommend.ts` quotes it and
   * `prompts.ts#rowLine` shows it. Quoting the later lines licensed figures no
   * chapter can print — the removable part of the widening, and the part that
   * put bare percentages in the pack with no clause to explain them.
   */
  it("does not quote figures from a detail line nothing reads", () => {
    const row = REAL_ROWS[13][1];
    expect(row.detail[0]).toBe("Year 2030 · Traditional IRA");
    expect(row.detail[1]).toBe("New growth 6.2%/yr (custom mix)");

    const displays = factDisplaySet(buildStoryFacts({ ...input, strategies: [STRATEGIES[13]] }));
    expect(displays.has("2030")).toBe(true); // detail[0], and the chapter prints it
    expect(displays.has("6.2%")).toBe(false); // detail[1], which nothing reads
  });

  it("quotes the before/after pair an edit row carries", () => {
    const row = REAL_ROWS[8][1];
    expect([row.before, row.after]).toEqual(["$100k", "$150k"]);
    const displays = factDisplaySet(buildStoryFacts({ ...input, strategies: [STRATEGIES[8]] }));
    expect(displays.has("$100k")).toBe(true);
    expect(displays.has("$150k")).toBe(true);
  });

  /**
   * The report's formatting rules are Task 1's, written for figures the deck
   * formats itself. A quoted token is held to them by SHAPE: anything this
   * document's own formatter could not have produced is not admitted, and its
   * clause degrades exactly as it did before quoting existed.
   *
   * All-or-nothing per clause, because grounding is: a detail prints only when
   * every figure in it is in the pack, so a clause holding one bad figure will
   * never print, and admitting its other figures would license the model to use
   * numbers from a sentence the client never sees.
   */
  it.each([
    // two decimals — the plan allows at most one. `describe/kinds/cashflow.ts`
    // writes an interest rate as `(r * 100).toFixed(2)`.
    ["$300k · 4.50% · $1.8k/mo", []],
    // accounting parens. `extractFigures` strips them, so the TOKEN looks
    // compliant ("$50k") while the text around it is not — the check has to see
    // the source, and it rejects the whole clause.
    ["Annual amount: ($50k) → ($20k)", []],
    // cents
    ["Annual amount: $1,234.56 → $2,000.00", []],
    // …and the compliant shapes still come through whole.
    ["Traditional IRA · $25k/yr · 50% Roth · 2026 → 2035", ["$25k", "50%", "2026", "2035"]],
    ["$50k/yr from Traditional IRA → Roth IRA · 2028–2033", ["$50k", "2028", "2033"]],
    ["Sale of $812 · 6.2% · $3.4M · $1,234", ["$812", "6.2%", "$3.4M", "$1,234"]],
  ] as const)("admits only deck-shaped figures from %j", (detail, expected) => {
    const strategy: StoryStrategy = {
      name: "S",
      rows: [{ area: "Savings", what: "S", op: "edit", before: "—", after: "Updated", detail: [detail] }],
    };
    const quoted = buildStoryFacts({ ...input, strategies: [strategy] })
      .filter((f) => f.raw === null)
      .map((f) => f.display);
    expect(quoted).toEqual(expected);
  });

  // The guard that survives a refactor: whatever the chapter prints, for
  // whatever change shape, must be grounded in the pack.
  it.each(REAL_ROWS.map(([name], i) => [name, i] as const))(
    "prints only grounded figures for %s",
    (_name, i) => {
      const ctx = contextFor([STRATEGIES[i]], [STRATEGIES[i]]);
      expect(ungroundedFigures(narrateWhatWeRecommend(ctx).join(" "), ctx.facts)).toEqual([]);
    },
  );
});

/**
 * The measurement Task 9 exists to move, kept as a test so the numbers stay
 * reproducible. Task 6's review found that `what-we-recommend.ts` degrades any
 * detail carrying an ungrounded figure to "<name> — this changes your taxes.".
 * Every figure-bearing describer hit that path, so the chapter the deck is
 * named after read near-contentless. The suppression is correct; the missing
 * half was having the figures in the pack.
 */
describe("regrounding measurement: strategy details survive instead of degrading", () => {
  const degraded = (packStrategies: StoryStrategy[]) =>
    STRATEGIES.filter((s) =>
      GENERIC_CLAUSE.test(narrateWhatWeRecommend(contextFor([s], packStrategies)).join(" ")),
    ).map((s) => s.name);

  /**
   * Both sides of the change, in one run, so neither number can rot.
   *
   * The two shapes that still degrade are the two the shape filter deliberately
   * refuses — they are the COST of the narrowing, not a failure of the
   * regrounding, and both were also degraded before. Nothing regressed: the
   * "after" set is a strict subset of the "before" set.
   */
  it("degraded 11 of 16 real change shapes before, and 2 after", () => {
    expect(STRATEGIES).toHaveLength(16);

    const before = degraded([]);
    const after = degraded(STRATEGIES);

    expect(before).toHaveLength(11);
    expect(after).toEqual([
      "Take the mortgage", // "4.50%" — two decimals
      "Trim the negative expense", // "($50k)" — accounting parens
    ]);
    // Every shape that still degrades already degraded before the change.
    expect(before).toEqual(expect.arrayContaining(after));
  });

  it("prints the change's own words once its figures are in the pack", () => {
    const ctx = contextFor([STRATEGIES[5]], [STRATEGIES[5]]);
    expect(narrateWhatWeRecommend(ctx)).toEqual([
      "Roth ladder — $50k/yr from Traditional IRA → Roth IRA · 2028–2033.",
    ]);
  });

  /**
   * The leak the shape filter could NOT close on its own, found by running the
   * 16-shape harness rather than by reading the code.
   *
   * `extractFigures("($50k)")` returns "$50k", so refusing to QUOTE from a
   * parenthesised clause does not keep that clause off the page: a Roth
   * conversion of "$50k/yr" and a savings edit of "$20k → $25k" put both tokens
   * in the pack on their own merits, and the negative clause is then perfectly
   * grounded. Closed at the point of printing, where the text is still visible.
   */
  it("refuses an accounting-paren negative even when another change grounds its figures", () => {
    const pack = buildStoryFacts({ ...input, strategies: STRATEGIES });
    const displays = factDisplaySet(pack);
    // Both tokens really are in the pack, quoted from other changes.
    expect(displays.has("$50k")).toBe(true);
    expect(displays.has("$20k")).toBe(true);

    const ctx: StoryContext = { ...contextFor([STRATEGIES[15]], STRATEGIES) };
    expect(STRATEGIES[15].rows[0].detail[0]).toBe("Annual amount: ($50k) → ($20k)");
    const line = narrateWhatWeRecommend(ctx).join(" ");
    expect(line).toBe("Trim the negative expense — this changes your spending.");
    expect(line).not.toContain("($50k)");
  });

  it("still degrades a detail whose figures the pack does not hold", () => {
    // The failing-closed half must keep failing closed: a row that was never
    // grouped into the pack's strategies is still suppressed.
    const ctx = contextFor([STRATEGIES[5]], []);
    expect(narrateWhatWeRecommend(ctx)).toEqual(["Roth ladder — this changes your taxes."]);
  });
});

describe("groupStrategies", () => {
  const row = (what: string): ChangeRow => ({
    area: "Income",
    what,
    op: "edit",
    before: "67",
    after: "70",
    detail: ["moves"],
  });

  it("collapses toggle-group members into one named strategy", () => {
    const out = groupStrategies(
      [
        { change: { toggleGroupId: "g1" }, row: row("Alan's SS") },
        { change: { toggleGroupId: "g1" }, row: row("Teresa's SS") },
      ],
      [{ id: "g1", name: "Delay Social Security" }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Delay Social Security");
    expect(out[0].rows).toHaveLength(2);
  });

  it("gives an ungrouped change its own strategy named after the change", () => {
    const out = groupStrategies([{ change: { toggleGroupId: null }, row: row("Retirement age") }], []);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Retirement age");
  });

  // RULING C1 — the brief fell back to the literal word "Strategy" for a
  // toggle group id with no matching group. That is client-facing text on the
  // recommendation card, and it names nothing.
  it.each([
    ["no matching group", [] as Array<{ id: string; name: string }>],
    ["a group whose name is blank", [{ id: "g1", name: "   " }]],
  ])("names a group after its first change when there is %s", (_case, groups) => {
    const out = groupStrategies(
      [
        { change: { toggleGroupId: "g1" }, row: row("Alan's SS") },
        { change: { toggleGroupId: "g1" }, row: row("Teresa's SS") },
      ],
      groups,
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Alan's SS");
    expect(out[0].name).not.toBe("Strategy");
  });

  // RULING C2 — the brief returned every group before every single, so the
  // deck's recommendation order did not follow the Scenario Changes table the
  // client is reading alongside it.
  it("keeps the changes in the order they arrive", () => {
    const out = groupStrategies(
      [
        { change: { toggleGroupId: null }, row: row("Retirement age") },
        { change: { toggleGroupId: "g1" }, row: row("Alan's SS") },
        { change: { toggleGroupId: null }, row: row("Travel") },
        { change: { toggleGroupId: "g1" }, row: row("Teresa's SS") },
      ],
      [{ id: "g1", name: "Delay Social Security" }],
    );
    expect(out.map((s) => s.name)).toEqual(["Retirement age", "Delay Social Security", "Travel"]);
    expect(out[1].rows.map((r) => r.what)).toEqual(["Alan's SS", "Teresa's SS"]);
  });

  // `addRow` writes "+ Name" for the table's WHAT column. In prose that marker
  // reads as a typo — plan-in-one-page joins these names into a sentence.
  it("drops the changes table's add marker from a derived name", () => {
    const add: ChangeRow = { area: "Income", what: "+ Rental income", op: "add", before: "—", after: "Added", detail: [] };
    const out = groupStrategies([{ change: { toggleGroupId: null }, row: add }], []);
    expect(out[0].name).toBe("Rental income");
  });

  // …but only on the op that writes it. A household can name an account
  // "+Growth Fund", and an edit row's WHAT is that name verbatim.
  it("leaves a leading plus alone on a row that is not an add", () => {
    const out = groupStrategies([{ change: { toggleGroupId: null }, row: row("+Growth Fund") }], []);
    expect(out[0].name).toBe("+Growth Fund");
  });
});
