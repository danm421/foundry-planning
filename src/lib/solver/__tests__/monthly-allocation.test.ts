import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData, sampleLiabilities } from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { buildMonthlyAllocation, spread } from "../monthly-allocation";
import { deflator } from "../monthly-cash-flow";

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe("buildMonthlyAllocation — reconciliation", () => {
  const clientData = buildClientData();
  const years = runProjection(clientData);

  it("emits twelve months, January through December", () => {
    const rows = buildMonthlyAllocation(years[0], clientData, "nominal");
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows[0].label).toBe("January");
    expect(rows[11].label).toBe("December");
  });

  // The invariant the whole module exists to keep. Checked on EVERY year, not
  // just the first: a bug that only bites once income stops would hide in year 1.
  it("sums back to the year, per category, on every projection year", () => {
    for (const y of years) {
      const rows = buildMonthlyAllocation(y, clientData, "nominal");
      expect(sum(rows.map((r) => r.income))).toBeCloseTo(y.totalIncome, 6);
      expect(sum(rows.map((r) => r.taxes))).toBeCloseTo(y.expenses.taxes, 6);
      expect(sum(rows.map((r) => r.debt))).toBeCloseTo(y.expenses.liabilities, 6);
      expect(sum(rows.map((r) => r.savings))).toBeCloseTo(y.savings.total, 6);
      expect(sum(rows.map((r) => r.living))).toBeCloseTo(y.expenses.living, 6);
      expect(sum(rows.map((r) => r.portfolioDraw))).toBeCloseTo(y.withdrawals.total, 6);
      expect(sum(rows.map((r) => r.other))).toBeCloseTo(
        y.expenses.insurance + y.expenses.realEstate + y.expenses.other,
        6,
      );
    }
  });

  // A tolerance-based check would pass on a module that loses a cent a month, so
  // the guard is kept tight — but NOT at `toBe`. `totalIncome` and a twelve-month
  // sum are two different float associations of the same terms, and the engine
  // adds its buckets in a different order than twelve monthly additions do
  // (measured: 250000.00000000009 vs 250000). Nine places still catches a lost
  // cent by seven orders of magnitude. Exactness is asserted where it is actually
  // achievable — on `spread`, below.
  it("reconciles income to nine decimal places across rows", () => {
    const rows = buildMonthlyAllocation(years[0], clientData, "nominal");
    expect(sum(rows.map((r) => r.income))).toBeCloseTo(years[0].totalIncome, 9);
  });
});

describe("spread — the December-remainder guarantee", () => {
  // Awkward binary representations: a naive twelve-times-`total/12` loses the
  // last bits on every one of these.
  const awkward = [1_000_000 / 7, 0.1, 12_345.67, 1 / 3, 99_999.99];

  it("an even split sums back to the total EXACTLY", () => {
    for (const total of awkward) {
      expect(sum(spread(total, null))).toBe(total);
    }
  });

  it("a dated amount lands whole in its own month", () => {
    const parts = spread(1_000_000 / 7, 3);
    expect(parts[2]).toBe(1_000_000 / 7);
    expect(sum(parts)).toBe(1_000_000 / 7);
  });
});

// The residual true-up is what makes reconciliation true by construction rather
// than true by fixture. These two name the engine paths that make it necessary,
// so a future edit that deletes the true-up fails with a legible reason.
describe("buildMonthlyAllocation — the residual true-up", () => {
  it("reconciles income in an RMD year, where bySource explains less than the year", () => {
    const clientData = buildClientData();
    const years = runProjection(clientData);
    // `householdRmdIncome` is folded into `totalIncome` with no `income.bySource`
    // key of its own (projection.ts:7102). The fixture's acct-401k has
    // rmdEnabled, so the gap opens the year the client turns 75.
    const y = years.find((x) => x.year === 2045)!;
    const explained = sum(Object.values(y.income.bySource));
    expect(y.totalIncome - explained).toBeGreaterThan(90_000);

    const rows = buildMonthlyAllocation(y, clientData, "nominal");
    expect(sum(rows.map((r) => r.income))).toBeCloseTo(y.totalIncome, 6);
  });

  it("reconciles `other` when a cash gift carries no bySource key", () => {
    const clientData = buildClientData({
      giftEvents: [
        {
          kind: "cash",
          year: 2026,
          amount: 25_000,
          grantor: "client",
          // The fixture has no checking account, so the gift needs an explicit
          // household-owned source or the engine skips it entirely.
          sourceAccountId: "acct-savings",
          useCrummeyPowers: false,
        },
      ],
    });
    const years = runProjection(clientData);
    const y = years[0];
    // `householdCashGiftsTotal` is inside `expenses.other` (projection.ts:6977)
    // with no `bySource` key at all.
    expect(y.expenses.cashGifts).toBeGreaterThan(0);

    const rows = buildMonthlyAllocation(y, clientData, "nominal");
    expect(sum(rows.map((r) => r.other))).toBeCloseTo(
      y.expenses.insurance + y.expenses.realEstate + y.expenses.other,
      6,
    );
  });
});

// ============================================================================
// Behaviour, not reconciliation. The residual true-up makes the twelve months
// sum back to the year BY CONSTRUCTION, so reconciliation alone can no longer
// see a row landing in the wrong month or in the wrong column — the residual
// silently absorbs both. Everything below asks the other question: does the
// allocator put each dollar where it belongs?
// ============================================================================

describe("buildMonthlyAllocation — placement", () => {
  const clientData = buildClientData();

  it("lands a dated row wholly in its month and nowhere else", () => {
    const target = clientData.incomes[0];
    const dated = {
      ...clientData,
      incomes: clientData.incomes.map((i) =>
        i.id === target.id ? { ...i, paymentMonth: 3 } : { ...i, paymentMonth: null },
      ),
    };
    const years = runProjection(dated);
    const rows = buildMonthlyAllocation(years[0], dated, "nominal");
    const contributed = years[0].income.bySource[target.id] ?? 0;
    expect(contributed).toBeGreaterThan(0);

    // March carries that row's whole amount ON TOP of the even spread of the
    // others, so compare March against a run where nothing is dated.
    const undated = { ...dated, incomes: dated.incomes.map((i) => ({ ...i, paymentMonth: null })) };
    const flat = buildMonthlyAllocation(runProjection(undated)[0], undated, "nominal");
    expect(rows[2].income - flat[2].income).toBeCloseTo(contributed * (11 / 12), 6);
    // "and nowhere else": every OTHER month is down by exactly the twelfth it
    // used to carry, so none of the row's dollars leaked anywhere but March.
    for (let i = 0; i < 12; i++) {
      if (i === 2) continue;
      expect(rows[i].income - flat[i].income).toBeCloseTo(-contributed / 12, 6);
    }
  });

  // December included: it carries `spread`'s exact remainder, which is a twelfth
  // plus the last few bits — six places is far tighter than that dust.
  it("gives every month an exact twelfth when no row is dated", () => {
    const undated = {
      ...clientData,
      incomes: clientData.incomes.map((i) => ({ ...i, paymentMonth: null })),
    };
    const years = runProjection(undated);
    const rows = buildMonthlyAllocation(years[0], undated, "nominal");
    for (let i = 0; i < 12; i++) {
      expect(rows[i].income).toBeCloseTo(years[0].totalIncome / 12, 6);
    }
  });

  // HONEST SCOPE — read this before trusting the test's name. Since the residual
  // true-up landed (Task 5, ruling D7), this test can no longer tell "spread the
  // unknown key evenly" apart from "drop the unknown key and let the income
  // residual put the same dollars back": both produce byte-identical months. It
  // is kept because it still catches the dollars VANISHING — an allocator that
  // dropped unrecognised keys AND lost the true-up leaves June flat and the year
  // 120,000 short — and because it documents the never-enumerate-synthetic-keys
  // rule with a deliberately synthetic key. The dated-row placement tests above
  // and the column-routing tests below are what actually discriminate.
  it("spreads an unrecognised bySource key evenly instead of dropping it", () => {
    const years = runProjection(clientData);
    const y = years[0];
    const spiked = {
      ...y,
      income: {
        ...y.income,
        bySource: { ...y.income.bySource, "life-insurance-proceeds:not-a-row": 120_000 },
      },
      totalIncome: y.totalIncome + 120_000,
    };
    const rows = buildMonthlyAllocation(spiked, clientData, "nominal");
    expect(sum(rows.map((r) => r.income))).toBeCloseTo(y.totalIncome + 120_000, 6);
    const base = buildMonthlyAllocation(y, clientData, "nominal");
    expect(rows[5].income - base[5].income).toBeCloseTo(10_000, 6);
  });

  // A dated row that pays NOTHING this year must not put a phantom spike in its
  // month. Only ONE row is killed, so a live row is still there paying: an
  // allocator that returned zeros for everything could not pass this.
  it("a row contributing nothing this year contributes nothing in any month", () => {
    const withDeadRow = {
      ...clientData,
      incomes: clientData.incomes.map((i) =>
        i.id === "inc-salary-john"
          ? // Ended before the plan starts, and dated to July.
            { ...i, endYear: clientData.planSettings.planStartYear - 1, paymentMonth: 7 }
          : { ...i, paymentMonth: null },
      ),
    };
    const y = runProjection(withDeadRow)[0];
    // The engine drops the row from `bySource` entirely rather than writing a
    // zero, so the allocator never even sees its month.
    expect(y.income.bySource["inc-salary-john"]).toBeUndefined();
    expect(y.totalIncome).toBeGreaterThan(0);

    const rows = buildMonthlyAllocation(y, withDeadRow, "nominal");
    // Every month, July included, is a plain twelfth of the surviving income.
    for (const r of rows) expect(r.income).toBeCloseTo(y.totalIncome / 12, 6);
  });
});

// Ruling B. Filing a `living` row under `other` leaves BOTH columns reconciling
// — each category's residual absorbs the routing error — so the headline
// reconciliation test is blind to it. These two are not: they assert which
// COLUMN the dated dollars land in, and that the other column is untouched.
describe("buildMonthlyAllocation — column routing", () => {
  const clientData = buildClientData();
  const livingRows = clientData.expenses.filter((e) => e.type === "living");
  const otherRows = clientData.expenses.filter((e) => e.type !== "living");

  // CANARY, not a guard on the assertions below — those are delta-based (a
  // dated run minus an all-undated one), so an extra UNDATED row on either side
  // cancels out and would not break them. What this pins is that `dateOnly`
  // below still names a row of the kind its caller believes it does. Note the
  // `other` column is NOT just `exp-insurance`: 2026's `expenses.bySource` also
  // carries `synth-proptax-acct-home` at 12,000, which reaches `other` through
  // the unknown-key path.
  it("the fixture still has one living row and one non-living row", () => {
    expect(livingRows.map((e) => e.id)).toEqual(["exp-living"]);
    expect(otherRows.map((e) => e.id)).toEqual(["exp-insurance"]);
  });

  const undated = {
    ...clientData,
    expenses: clientData.expenses.map((e) => ({ ...e, paymentMonth: null })),
  };
  const dateOnly = (id: string, month: number) => ({
    ...clientData,
    expenses: clientData.expenses.map((e) =>
      e.id === id ? { ...e, paymentMonth: month } : { ...e, paymentMonth: null },
    ),
  });

  it("puts a dated LIVING row in the living column, leaving other untouched", () => {
    const flat = buildMonthlyAllocation(runProjection(undated)[0], undated, "nominal");
    const data = dateOnly("exp-living", 4);
    const y = runProjection(data)[0];
    const rows = buildMonthlyAllocation(y, data, "nominal");

    const amount = y.expenses.bySource["exp-living"] ?? 0;
    expect(amount).toBeGreaterThan(0);
    // April carries the row's whole year; every other month carries none of it.
    expect(rows[3].living - flat[3].living).toBeCloseTo(amount * (11 / 12), 6);
    expect(rows[0].living - flat[0].living).toBeCloseTo(-amount / 12, 6);
    // …and NOTHING moved in `other`. Inverting the routing reds this test at
    // the April assertion above (April's `living` delta collapses to 0 against
    // an expected 73,333.33 — the 80,000 row's 11/12 spike), so execution never
    // reaches this loop; the loop is what pins the converse direction under the
    // sibling test below.
    for (let i = 0; i < 12; i++) expect(rows[i].other).toBeCloseTo(flat[i].other, 6);
  });

  it("puts a dated NON-LIVING row in the other column, leaving living untouched", () => {
    const flat = buildMonthlyAllocation(runProjection(undated)[0], undated, "nominal");
    const data = dateOnly("exp-insurance", 4);
    const y = runProjection(data)[0];
    const rows = buildMonthlyAllocation(y, data, "nominal");

    const amount = y.expenses.bySource["exp-insurance"] ?? 0;
    expect(amount).toBeGreaterThan(0);
    expect(rows[3].other - flat[3].other).toBeCloseTo(amount * (11 / 12), 6);
    expect(rows[0].other - flat[0].other).toBeCloseTo(-amount / 12, 6);
    for (let i = 0; i < 12; i++) expect(rows[i].living).toBeCloseTo(flat[i].living, 6);
  });
});

const MORTGAGE = sampleLiabilities[0].id;

describe("buildMonthlyAllocation — debt and the running balance", () => {
  const clientData = buildClientData();
  const years = runProjection(clientData);

  it("stops charging a loan after its final payment month", () => {
    // The fixture's mortgage is a 240-month term at a payment large enough to
    // retire it early: its last year pays THREE months, not twelve.
    let lastIdx = -1;
    for (let i = 0; i < years.length; i++) {
      if ((years[i].expenses.byLiability[MORTGAGE] ?? 0) > 0) lastIdx = i;
    }
    expect(lastIdx).toBeGreaterThan(0);
    const payoff = years[lastIdx];
    // Fixture guard: a final year that paid a full twelve months would make the
    // rest of this test vacuous — it would have nothing left to prove.
    expect(payoff.expenses.liabilities).toBeLessThan(
      years[lastIdx - 1].expenses.liabilities * 0.9,
    );

    const rows = buildMonthlyAllocation(payoff, clientData, "nominal");
    let lastCharged = -1;
    for (let i = 0; i < 12; i++) if (Math.abs(rows[i].debt) > 1e-9) lastCharged = i;
    // It stopped before December — that is the payoff.
    expect(lastCharged).toBeLessThan(11);
    for (let i = lastCharged + 1; i < 12; i++) expect(rows[i].debt).toBeCloseTo(0, 9);
    // …and the months it DID charge are real money, so an all-zero debt column
    // cannot pass this by accident.
    for (let i = 0; i <= lastCharged; i++) expect(rows[i].debt).toBeGreaterThan(1_000);
    expect(sum(rows.map((r) => r.debt))).toBeCloseTo(payoff.expenses.liabilities, 6);
  });

  it("reconciles debt and never goes negative on this fixture", () => {
    const rows = buildMonthlyAllocation(years[0], clientData, "nominal");
    expect(sum(rows.map((r) => r.debt))).toBeCloseTo(years[0].expenses.liabilities, 6);
    // FIXTURE-SPECIFIC, not an invariant the allocator promises. It holds here
    // only because this mortgage is 100% household-owned, so its debt residual
    // is zero. The entity-owned test below shows the same column going negative
    // — correctly — and must not be "fixed".
    for (const r of rows) expect(r.debt).toBeGreaterThanOrEqual(0);
  });

  // NAMED FOR WHAT IT CHECKS: that the column is a RUNNING total, not a
  // per-month figure. The OPENING term is pinned separately by the two tests
  // below — neither of which this one can see.
  it("carries a running balance — each month closes at the previous close plus its net", () => {
    const rows = buildMonthlyAllocation(years[0], clientData, "nominal");
    // `cashOnHand` is an END-of-month balance, so the opening is month 1's
    // balance minus month 1's net. Do NOT "simplify" this to rows[0].cashOnHand.
    const opening = rows[0].cashOnHand - rows[0].net;
    expect(rows[11].cashOnHand).toBeCloseTo(opening + sum(rows.map((r) => r.net)), 6);
    for (let i = 1; i < 12; i++) {
      expect(rows[i].cashOnHand).toBeCloseTo(rows[i - 1].cashOnHand + rows[i].net, 6);
    }
  });

  // Ruling F1, which AMENDS Task 5's cashOnHand ruling. That ruling's "do not
  // assert it equals any account balance" binds the RUNNING total — no month's
  // close is any account's balance, and pinning one would encode the very
  // stock/flow confusion the ruling exists to flag. It does not bind the
  // OPENING SEED, which the spec defines in these words: "opens at the sum of
  // `beginningValue` across the household's liquid accounts."
  //
  // Measured before this test existed: replacing the seed with `let cash = 0`
  // left all 23 tests in this file GREEN. The whole first half of that spec
  // sentence was unpinned.
  //
  // 1,050,000 is read off `fixtures.ts`, never off the module: acct-401k
  // 500,000 + acct-roth 200,000 + acct-brokerage 300,000 + acct-savings 50,000.
  // acct-home (750,000) is real_estate and so is not liquid — excluding it is
  // the half of the definition an implementation could plausibly get wrong, and
  // the literal is what makes that visible.
  it("opens at the household's beginning liquid balance, excluding the house", () => {
    const rows = buildMonthlyAllocation(years[0], clientData, "nominal");
    expect(rows[0].cashOnHand - rows[0].net).toBeCloseTo(1_050_000, 6);
  });

  // The seed is a NOMINAL account balance until it is multiplied by k. Drop
  // that one `* k` and the column becomes a nominal opening carrying deflated
  // flows — a mixed-basis number on the face of Task 8's table. Measured: with
  // the `* k` dropped, every other test in this file stays green.
  //
  // Compared against the same year's nominal run rather than a literal, because
  // by year 10 the accounts have grown; `k < 0.8` is asserted independently, so
  // a dropped `* k` (which would make the two openings equal) cannot pass.
  it("deflates that opening too, so the column is one basis end to end", () => {
    const y = years[10];
    const k = deflator(y.year, "today", clientData.planSettings);
    expect(k).toBeLessThan(0.8);
    const nominal = buildMonthlyAllocation(y, clientData, "nominal");
    const today = buildMonthlyAllocation(y, clientData, "today");
    const nominalOpening = nominal[0].cashOnHand - nominal[0].net;
    const todayOpening = today[0].cashOnHand - today[0].net;
    expect(nominalOpening).toBeGreaterThan(0);
    expect(todayOpening).toBeCloseTo(nominalOpening * k, 6);
  });

  // Ruling F2. Nothing in this file read `net` at all before: flipping the sign
  // on one of its terms — measured with `debt` — left all 23 tests green, and
  // `net` is the number Task 8's table and Task 9's chart both put on screen.
  //
  // This is not a mirror of the implementation: it asserts the ROW's published
  // columns add up to the ROW's published net, which is what a reader of the
  // table will do by eye. Asserted per month AND on the year, so a per-column
  // sign error that happened to cancel across twelve months still reds.
  it("nets each month to income plus draw, less every committed outflow", () => {
    const y = years[0];
    const rows = buildMonthlyAllocation(y, clientData, "nominal");
    // Scope, stated rather than assumed: this fixture never spends a surplus,
    // so the formula's `− surplusSpent` term is NOT exercised here. The spiked
    // test below is what covers it.
    expect(y.expenses.discretionary).toBe(0);
    for (const r of rows) {
      expect(r.net).toBeCloseTo(
        r.income + r.portfolioDraw - r.taxes - r.debt - r.savings - r.other - r.living,
        6,
      );
    }
    // …and the year's own totals agree, anchored on a measured literal so the
    // check is not purely self-referential: 250,000 income, less 67,500 tax,
    // 30,000 debt service, 23,500 savings, 17,000 other and 80,000 living.
    const yearNet =
      y.totalIncome +
      y.withdrawals.total -
      y.expenses.taxes -
      y.expenses.liabilities -
      y.savings.total -
      (y.expenses.insurance + y.expenses.realEstate + y.expenses.other) -
      y.expenses.living;
    expect(yearNet).toBeCloseTo(32_000, 6);
    expect(sum(rows.map((r) => r.net))).toBeCloseTo(yearNet, 6);
  });

  // The `− surplusSpent` term is unreachable from this fixture: `discretionary`
  // is 0 in all 30 years, and reaching it needs BOTH a default-checking account
  // and a `surplusSpendPct` — a change that re-routes cash in every year and
  // would move numbers every other test here depends on. Spiking the year is
  // the same technique the synthetic-key test uses: it asks the allocator what
  // it does with a year that carries discretionary spend, which is precisely
  // what it promises to handle.
  //
  // TASK 8, BINDING: `MonthRow` has no `surplusSpent` column, so in a year with
  // discretionary spend the row's VISIBLE columns do not add up to its `net` —
  // the gap asserted below. That is a presentation decision Task 8 owes; it is
  // not a bug and must not be "fixed" by hiding it.
  it("subtracts discretionary surplus spend from net, though no column shows it", () => {
    const y = years[0];
    const spiked = { ...y, expenses: { ...y.expenses, discretionary: 60_000 } };
    const base = buildMonthlyAllocation(y, clientData, "nominal");
    const rows = buildMonthlyAllocation(spiked, clientData, "nominal");
    for (let i = 0; i < 12; i++) {
      expect(rows[i].net - base[i].net).toBeCloseTo(-5_000, 6);
      // Invisible in every published column — that is the whole point.
      expect(rows[i].living).toBeCloseTo(base[i].living, 6);
      expect(rows[i].other).toBeCloseTo(base[i].other, 6);
      expect(rows[i].taxes).toBeCloseTo(base[i].taxes, 6);
    }
  });

  // SHAPE ONLY. A ratio is scale-invariant, so this cannot see the basis being
  // ignored altogether — measured: pinning k at 1 leaves this test green. What
  // it does catch is the deflator being applied PER MONTH rather than per year.
  // The absolute assertions in the `today` basis block below pin the magnitude.
  it("applies the dollar basis once, not twelve times", () => {
    const nominal = buildMonthlyAllocation(years[5], clientData, "nominal");
    const today = buildMonthlyAllocation(years[5], clientData, "today");
    const ratio = sum(today.map((r) => r.income)) / sum(nominal.map((r) => r.income));
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
    // Every month scales by the SAME factor — a per-month deflator would not.
    for (let i = 0; i < 12; i++) {
      if (nominal[i].income === 0) continue;
      expect(today[i].income / nominal[i].income).toBeCloseTo(ratio, 9);
    }
  });
});

// Ruling D. Task 5 measured the residuals across all 30 fixture years: `debt`
// is literal zero in every one of them, so the debt true-up shipped with no
// test behind it at all. It exists for a real engine path nobody had written
// down: `liabilities.ts:95` puts each loan's FULL payment in `byLiability`,
// while `projection.ts:1660-1668` reduces `expenses.liabilities` to the
// HOUSEHOLD SHARE. On a partly entity-owned loan those two differ, and the
// residual is the only thing closing the gap.
describe("buildMonthlyAllocation — a partly entity-owned liability", () => {
  const splitMortgage = (startMonth: number) =>
    buildClientData({
      liabilities: [
        {
          ...sampleLiabilities[0],
          startMonth,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
            { kind: "entity", entityId: "ent-llc", percent: 0.4 },
          ],
        },
      ],
    });

  it("reconciles debt to the HOUSEHOLD share, not the loan's full payment", () => {
    const clientData = splitMortgage(1);
    const y = runProjection(clientData)[0];
    const full = y.expenses.byLiability[MORTGAGE] ?? 0;
    // The gap this test exists for. Without it the assertions below are vacuous.
    expect(full).toBeCloseTo(30_000, 6);
    expect(y.expenses.liabilities).toBeCloseTo(full * 0.6, 6);

    const rows = buildMonthlyAllocation(y, clientData, "nominal");
    expect(sum(rows.map((r) => r.debt))).toBeCloseTo(y.expenses.liabilities, 6);
    // The −40% residual is spread evenly, so each month is the loan's own
    // monthly payment less a twelfth of the entity's share: 2500 − 1000.
    for (const r of rows) expect(r.debt).toBeCloseTo(1_500, 6);
  });

  it("lets the residual go NEGATIVE in months the loan had not started", () => {
    // Originated in July, so `spreadLoan` charges six months of 2,500 while the
    // household-share residual of −6,000 spreads across all twelve. January
    // through June are legitimately negative. Clamping the residual at zero
    // would break reconciliation, which is why the allocator does not.
    const clientData = splitMortgage(7);
    const y = runProjection(clientData)[0];
    const rows = buildMonthlyAllocation(y, clientData, "nominal");
    expect(sum(rows.map((r) => r.debt))).toBeCloseTo(y.expenses.liabilities, 6);
    for (let i = 0; i < 6; i++) expect(rows[i].debt).toBeCloseTo(-500, 6);
    for (let i = 6; i < 12; i++) expect(rows[i].debt).toBeCloseTo(2_000, 6);
  });
});

// Ruling C. Every other call in this file passes "nominal", where the deflator
// k is 1 — so a term that forgot to multiply by k would be invisible. These
// assert ABSOLUTE deflated dollars, not a ratio against the nominal run (a
// ratio is scale-invariant and cannot see a missing k either).
describe("buildMonthlyAllocation — the `today` basis", () => {
  const clientData = buildClientData();
  const years = runProjection(clientData);

  it("deflates every column to the year's own total times k", () => {
    const y = years[10];
    const k = deflator(y.year, "today", clientData.planSettings);
    // Late enough that k is unmistakably not 1.
    expect(k).toBeLessThan(0.8);
    const rows = buildMonthlyAllocation(y, clientData, "today");
    expect(sum(rows.map((r) => r.income))).toBeCloseTo(y.totalIncome * k, 6);
    expect(sum(rows.map((r) => r.living))).toBeCloseTo(y.expenses.living * k, 6);
    expect(sum(rows.map((r) => r.other))).toBeCloseTo(
      (y.expenses.insurance + y.expenses.realEstate + y.expenses.other) * k,
      6,
    );
    expect(sum(rows.map((r) => r.debt))).toBeCloseTo(y.expenses.liabilities * k, 6);
    expect(sum(rows.map((r) => r.taxes))).toBeCloseTo(y.expenses.taxes * k, 6);
    expect(sum(rows.map((r) => r.savings))).toBeCloseTo(y.savings.total * k, 6);
    expect(sum(rows.map((r) => r.portfolioDraw))).toBeCloseTo(y.withdrawals.total * k, 6);
  });

  it("deflates the income RESIDUAL too, not only what bySource explained", () => {
    // 2045 is an RMD year: ~98,600 of the year's income has no `bySource` key,
    // so most of the column comes from the true-up. If the true-up skipped its
    // `* k`, that 98,600 would arrive in nominal dollars on top of a deflated
    // remainder and this sum would overshoot by ~49% (measured: 128,523 against
    // an expected 86,147).
    const y = years.find((x) => x.year === 2045)!;
    const k = deflator(y.year, "today", clientData.planSettings);
    const residual = y.totalIncome - sum(Object.values(y.income.bySource));
    expect(residual).toBeGreaterThan(90_000);
    const rows = buildMonthlyAllocation(y, clientData, "today");
    expect(sum(rows.map((r) => r.income))).toBeCloseTo(y.totalIncome * k, 6);
  });

  it("deflates an expense residual too — a cash gift in a late year", () => {
    // `householdCashGiftsTotal` sits inside `expenses.other` with no `bySource`
    // key (projection.ts:6977), so 25,000 of this year's `other` column is pure
    // residual — and 2036's k is 0.744, so a missing `* k` shows immediately.
    const gifted = buildClientData({
      giftEvents: [
        {
          kind: "cash",
          year: 2036,
          amount: 25_000,
          grantor: "client",
          sourceAccountId: "acct-savings",
          useCrummeyPowers: false,
        },
      ],
    });
    const y = runProjection(gifted).find((x) => x.year === 2036)!;
    const k = deflator(y.year, "today", gifted.planSettings);
    expect(y.expenses.cashGifts).toBeCloseTo(25_000, 6);
    const rows = buildMonthlyAllocation(y, gifted, "today");
    expect(sum(rows.map((r) => r.other))).toBeCloseTo(
      (y.expenses.insurance + y.expenses.realEstate + y.expenses.other) * k,
      6,
    );
  });
});
