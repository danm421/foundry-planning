// Pure. Turns already-loaded plan figures into the fact pack, and already-
// described scenario changes into named strategies. No IO, no clock — the
// caller (load-context.ts) owns both.
import type { ChangeRow } from "@/lib/presentations/pages/scenario-changes/types";
import { hasAccountingNegative, moneyFact, pctFact, quotedFact, yearFact, type Fact } from "./facts";
import type { ChapterId, StoryGoal, StoryStrategy } from "./types";
import { extractFigures } from "./validate/facts";

export interface StoryFactsInput {
  todayAssets: number;
  todayDebts: number;
  todayLiquid: number;
  /** Null when Monte Carlo is unavailable — the fact is then omitted, never zeroed. */
  baseSuccess: number | null;
  proposedSuccess: number | null;
  baseEndLiquid: number;
  proposedEndLiquid: number | null;
  retirementYear: number;
  endOfLifeYear: number;
  /** The first projection year. Only used to decide whether the retirement year
   *  is still ahead — a household that retired years ago must not be told when
   *  they will stop working. */
  planStartYear: number;
  /**
   * The grouped changes, from `groupStrategies`. Required rather than optional
   * on purpose: the recommendation chapter prints these rows' own text, and it
   * prints nothing but a generic clause unless their figures are in the pack.
   * A caller that forgot to pass them would silently rebuild the defect this
   * argument exists to close, so the compiler asks for them.
   */
  strategies: StoryStrategy[];
  /**
   * The household's own goals, in the SAME order the context carries them.
   *
   * Required for the same reason `strategies` is: chapter 1 dates a goal by
   * reading its year back out of the pack, so a caller that forgot these would
   * publish every goal undated and nothing would say why. The order is
   * load-bearing — see `goalYearFactId`.
   */
  goals: StoryGoal[];
  /**
   * This year's cash flow, or null when the projection produced no years.
   *
   * Null rather than zeroes, exactly as the Monte Carlo facts are: a $0 income
   * printed because nothing loaded is a lie, and the narrator already handles an
   * absent figure.
   *
   * The three tie out to the deck's own Cash Flow page BY CONSTRUCTION —
   * `income - spending - saving` is the engine's `netCashFlow` — which is what
   * lets the narrator state the direction without printing a fourth total. See
   * `load-context.ts` for where each one comes from.
   */
  flow: { income: number; spending: number; saving: number } | null;
  /**
   * The first year the CURRENT plan cannot cover its own spending, or null when
   * it never does.
   *
   * Null is also what a projection with no years looks like, which is why the
   * narrator states the good case from a figure it HAS — the legacy left at the
   * end — rather than reading anything into this being absent.
   */
  shortfallYear: number | null;
  /**
   * The most the household could spend a year in retirement, in today's money —
   * one figure per plan, or null when the solve did not come back.
   *
   * Null rather than zero for the same reason Monte Carlo is: this is the figure
   * a client is most likely to ACT on, and a $0 printed because a solver timed
   * out is the worst lie this report could tell.
   */
  maxSpend: { base: number | null; proposed: number | null };
  /**
   * What the estate leaves behind at the end of the plan, per plan — or null
   * when there is no estate to report.
   *
   * Null rather than zeroes for the same reason Monte Carlo is: an empty estate
   * report and an estate worth nothing are different statements, and "$0 reaches
   * your heirs" printed because nothing loaded is the worse of the two.
   */
  estate: { base: StoryEstateTotals | null; proposed: StoryEstateTotals | null };
  /**
   * Income tax over the whole plan, per plan, or null when the tax engine
   * produced nothing.
   *
   * Null rather than zero again, and here the distinction is not theoretical: a
   * projection whose years carry no `taxResult` sums to exactly 0, which reads
   * on the page as a household that owes no tax for the rest of its life.
   */
  lifetimeTax: { base: number | null; proposed: number | null };
  /**
   * Life cover on ONE life — see `StoryCover` — or null when there are no
   * policies on file and no usable solve.
   *
   * Null rather than zeroes for the third time: "$0 of cover in place" and "we
   * have no policies on file for you" are different statements, and only the
   * second is honest about a household we simply have not asked yet.
   */
  cover: StoryCover | null;
  /**
   * What Medicare costs over the plan, or null when nobody enrols inside the
   * horizon.
   *
   * The CURRENT plan's, even on a deck that carries a proposal — the label says
   * so. This chapter needs no proposal (an advisor runs it on a base-only annual
   * review) and the arc has no Medicare comparison to make; a Roth conversion
   * does move the surcharge, and that belongs to the tax chapter, which already
   * states both plans.
   */
  medicare: { lifetime: number; irmaa: number } | null;
}

/**
 * Life cover, stated for ONE of the two lives.
 *
 * A household has two answers here — the plan needs a different amount on each
 * life — and this chapter has one prose column and five figure cards. So it
 * reports the life the household is FURTHEST SHORT on, which is the one an
 * advisor has to raise, and the labels name whose life it is because the cards
 * beside the prose are where a client reads it.
 *
 * Every figure comes off the same aggregate the deck's Life Insurance Summary
 * page builds its own gap from, at that page's solved death year.
 */
export interface StoryCover {
  /** The first name whose life these three figures are about. */
  on: string;
  /** In-force cover on that life at the solved death year. Expired term is
   *  already dropped — the engine excludes it from the need, so counting it
   *  would invert the shortfall. */
  have: number;
  /** What the plan points to IN TOTAL on that life: what is in force plus what
   *  the solve says is missing. The Life Insurance Summary page's own
   *  definition — comparing cover against the ADDITIONAL need alone reported a
   *  surplus whenever cover exceeded it. */
  need: number;
  /** …and the difference. Zero when the cover is enough, and the fact is then
   *  absent rather than "$0 short". */
  gap: number;
}

/**
 * One plan's estate outcome, in the two figures a client asks about.
 *
 * Both come off the SAME report the deck's Estate Summary page builds
 * (`summarizeHousehold`), so the chapter and that page cannot disagree about
 * what reaches the heirs — which under `documentRole: "frontMatter"` are a few
 * leaves apart in one PDF.
 */
export interface StoryEstateTotals {
  /** What reaches the heirs, after estate tax, settlement costs and debts. */
  net: number;
  /** Estate tax, probate and administration, and tax on income in respect of a
   *  decedent. Debts are NOT in it — they are money owed, not a cost of dying. */
  cost: number;
}

/** A quoted figure describes one proposed change, so it is meaningful in the
 *  recommendation chapter and nowhere else. A chapter about today's balance
 *  sheet has no business being licensed to print a future sale price. */
const QUOTED_CHAPTERS: readonly ChapterId[] = ["whatWeRecommend"];

/**
 * The shapes a quoted token may take.
 *
 * The report's formatting rules — at most one decimal, no cents, none of the
 * accounting conventions a table uses — were written for figures the deck
 * formats itself (`facts.ts` is their single source of truth). A figure quoted
 * from another module is a category those rules did not anticipate, so they are
 * applied here by SHAPE instead: a token that could not have come out of this
 * document's own formatter is not admitted, and the detail carrying it degrades
 * to the generic clause exactly as it did before any of this existed.
 *
 * Case is the one thing deliberately not checked. "$300k" against the pack's
 * "$300K" is the accepted cost of quoting — closing it would mean re-formatting
 * the token, which prints a DIFFERENT number ($1.5k → $2K), which is the whole
 * reason these figures are quoted rather than rebuilt.
 */
const QUOTABLE_SHAPES: readonly RegExp[] = [
  /^\$\d{1,3}(?:,\d{3})*$/u, // $812 · $1,234 — whole dollars, no cents
  /^\$\d+(?:\.\d)?[KMB]$/iu, // $25k · $1.8k · $2.1M — one decimal at most
  /^\d+(?:\.\d)?%$/u, // 50% · 6.2% — one decimal at most, so "4.50%" is out
  /^(?:19|20)\d{2}$/u, // 2041
];

/**
 * The figures in one source clause, or null when the clause is not quotable at
 * all.
 *
 * All-or-nothing per clause, not per token, because grounding is all-or-nothing
 * per clause: a detail prints only when EVERY figure in it is in the pack. So a
 * clause holding one non-compliant figure will never print, and admitting its
 * other figures would license the model to use numbers from a sentence the
 * client is never shown. The pack's quoted half is exactly the figures of the
 * clauses we are prepared to print.
 */
function quotableFigures(source: string): string[] | null {
  // Not sufficient on its own — the same clause is refused again at the point of
  // printing, because another change can put the identical token in the pack
  // legitimately. See `facts.ts#hasAccountingNegative`.
  if (hasAccountingNegative(source)) return null;
  const tokens = extractFigures(source);
  return tokens.every((t) => QUOTABLE_SHAPES.some((re) => re.test(t))) ? tokens : null;
}

/**
 * Every figure the strategy rows carry, admitted to the pack in the CHANGES
 * TABLE's spelling rather than this document's.
 *
 * Why the pack has to hold them at all: `chapters/what-we-recommend.ts` may
 * only print a `ChangeRow` detail when every figure in it is grounded, so with
 * a pack of plan totals alone every figure-bearing change — which is most of
 * them — degrades to "<name> — this changes your taxes." and the chapter the
 * deck is named after says nothing.
 *
 * Why the tokens are taken from `extractFigures` rather than picked out by
 * hand: the gate demands the figure be spelled EXACTLY as the pack spells it,
 * and the two formatters disagree on real values (`compactCurrency(1500)` is
 * "$1.5k"; `fmtUsdCompact(1500)` is "$2K"). Re-formatting would print a
 * different number to a client, and choosing a substring would drift from what
 * the gate considers a figure — `extractFigures("($50k)")` yields "$50k", the
 * parens excluded. Feeding the gate's own output back to it makes the
 * exact-spelling match true by construction.
 *
 * Only `detail[0]` and the before/after pair are read, because those are the
 * only fields anything prints or shows the model (`what-we-recommend.ts`
 * quotes `detail[0]`; `prompts.ts#rowLine` shows `detail[0]` and the pair).
 * Quoting the later detail lines licensed figures no chapter can reach — pure
 * widening, so it is gone until a chapter actually reads them.
 *
 * Deduplicated on `display`, which is the only thing anything compares here, so
 * ids stay unique by construction. The dedupe is case-SENSITIVE deliberately:
 * "$25k" and "$25K" are one value in two spellings, and the gate accepts only
 * the spelling actually written.
 */
function quoteStrategyFigures(strategies: StoryStrategy[], taken: Set<string>): Fact[] {
  const facts: Fact[] = [];
  for (const strategy of strategies) {
    for (const row of strategy.rows) {
      // The pair, joined the way `prompts.ts#rowLine` shows it, so the label
      // states a direction rather than leaving two bare amounts side by side.
      for (const source of [row.detail[0], `${row.before} → ${row.after}`]) {
        if (!source) continue;
        const tokens = quotableFigures(source);
        if (!tokens) continue;
        for (const token of tokens) {
          if (taken.has(token)) continue;
          taken.add(token);
          // The label quotes the clause the figure came from. Without it the
          // model sees two identical labels over "$20k" and "$25k" with nothing
          // saying which is the before — and an inverted recommendation clears
          // every gate, because Gate 1 checks spelling and never meaning. The
          // strategy named is where the token was FIRST seen; a figure shared by
          // two changes is one entry, under the earlier one.
          facts.push(
            quotedFact(`quoted.${token}`, `${strategy.name} — from "${source}"`, token, QUOTED_CHAPTERS),
          );
        }
      }
    }
  }
  return facts;
}

/**
 * Which chapters may print which figure.
 *
 * The mechanism (`Fact.chapters`, `factsForChapter`) shipped in Plan 1 and was
 * used for the quoted strategy figures alone, so every plan-level total was
 * visible to every chapter. The 2026-08-12 read is what that costs: "What you
 * have" is a balance-sheet chapter, it was handed confidence and legacy, and it
 * re-narrated all four of the headline chapter's figures on the sheet
 * immediately after them — on both households.
 *
 * The rule is one line: a chapter may print the figures it is ABOUT. The plan's
 * own years are the deliberate exception — a horizon is context for any chapter
 * that mentions time, and no chapter's subject is "2070".
 *
 * Undefined rather than "every chapter" for the shared entries: `factsForChapter`
 * treats a fact with no `chapters` as plan-level, so listing all fourteen here
 * would be a second list to keep in step with `CHAPTER_IDS`.
 */
const BALANCE_SHEET_CHAPTERS: readonly ChapterId[] = ["whatYouHave"];
/**
 * The base plan's own outcome figures belong to two chapters, not one: the
 * headline states them as the punchline, and chapter 4 is ABOUT the path they
 * describe. Nowhere else — the 2026-08-12 read found the balance-sheet chapter
 * re-narrating all four of the headline's figures on the very next sheet.
 */
const OUTCOME_CHAPTERS: readonly ChapterId[] = ["planInOnePage", "thePathYoureOn", "willTheMoneyLast"];
/** …and the PROPOSED plan's, which chapter 4 has nothing to say about: it is the
 *  path taken with nothing changed. */
const PROPOSED_OUTCOME_CHAPTERS: readonly ChapterId[] = ["planInOnePage", "willTheMoneyLast"];
/** Where today's plan ends up if nothing changes. */
const BASE_PATH_CHAPTERS: readonly ChapterId[] = ["thePathYoureOn"];
/** The most the household can spend a year — one chapter's whole subject. */
const SPEND_CHAPTERS: readonly ChapterId[] = ["whatYouCanSpend"];
/** A goal's date is only meaningful beside the goal it belongs to. */
const GOAL_CHAPTERS: readonly ChapterId[] = ["whatWerePlanningFor"];
/** This year's cash flow belongs to the chapter about this year's cash flow. */
const FLOW_CHAPTERS: readonly ChapterId[] = ["whereTheMoneyGoes"];
/** What reaches the heirs, and what settling the estate costs on the way. */
const ESTATE_CHAPTERS: readonly ChapterId[] = ["whatsLeftForPeople"];
/** …and what the household pays in income tax over the life of the plan. */
const TAX_CHAPTERS: readonly ChapterId[] = ["whatYoullPayInTax"];
/** What their life cover would do for the survivor. */
const COVER_CHAPTERS: readonly ChapterId[] = ["protectingYourFamily"];
/** …and what health care costs once work stops. */
const MEDICARE_CHAPTERS: readonly ChapterId[] = ["healthCareCosts"];

/**
 * The estate pair, both plans, in COMPARISON order — both nets, then both costs.
 *
 * The labels are written as captions rather than as notes to the model, because
 * on a `twoUp` chapter they are both: `view-model.ts#figuresFor` prints a
 * chapter's own facts as the figure cards beside its prose, using each fact's
 * `label` as the caption. This chapter is the one that fills that column.
 */
function estateFacts(estate: StoryFactsInput["estate"]): Fact[] {
  const facts: Fact[] = [];
  if (estate.base) {
    facts.push(
      moneyFact("estate.net.base", "What reaches your heirs, current plan", estate.base.net, ESTATE_CHAPTERS),
    );
  }
  if (estate.proposed) {
    facts.push(
      moneyFact("estate.net.proposed", "What reaches your heirs, proposed plan", estate.proposed.net, ESTATE_CHAPTERS),
    );
  }
  if (estate.base) {
    facts.push(
      moneyFact("estate.cost.base", "Tax and costs on the estate, current plan", estate.base.cost, ESTATE_CHAPTERS),
    );
  }
  if (estate.proposed) {
    facts.push(
      moneyFact("estate.cost.proposed", "Tax and costs on the estate, proposed plan", estate.proposed.cost, ESTATE_CHAPTERS),
    );
  }
  return facts;
}

function lifetimeTaxFacts(tax: StoryFactsInput["lifetimeTax"]): Fact[] {
  const facts: Fact[] = [];
  if (tax.base != null) {
    facts.push(
      moneyFact("tax.lifetime.base", "Total income tax over the plan, current plan", tax.base, TAX_CHAPTERS),
    );
  }
  if (tax.proposed != null) {
    facts.push(
      moneyFact("tax.lifetime.proposed", "Total income tax over the plan, proposed plan", tax.proposed, TAX_CHAPTERS),
    );
  }
  return facts;
}

/**
 * The three cover figures, labelled with the life they are about.
 *
 * The name is in the LABEL rather than in the prose, and that is deliberate:
 * Gate 6 rejects a first name used as anything but direct address, so a narrator
 * that wrote "on Alan's cover" would be judged for the one thing the label does
 * best — captioning its own figure on the card beside the paragraph.
 *
 * `cover.gap` is absent when there is nothing missing. A "$0 short" card is a
 * figure where a plain "that's enough" is the whole answer.
 */
function coverFacts(cover: StoryCover | null): Fact[] {
  if (!cover) return [];
  const facts = [
    moneyFact("cover.have", `Cover in force on ${cover.on}'s life`, cover.have, COVER_CHAPTERS),
    moneyFact("cover.need", `What the plan points to on ${cover.on}'s life`, cover.need, COVER_CHAPTERS),
  ];
  if (cover.gap > 0) {
    facts.push(moneyFact("cover.gap", `What's missing on ${cover.on}'s life`, cover.gap, COVER_CHAPTERS));
  }
  return facts;
}

/**
 * Medicare over the plan, and the higher-earner surcharge inside it.
 *
 * The surcharge is a SHARE of the total rather than a figure beside it, and the
 * narrator says so — printed as two independent amounts a client adds them
 * together. It is omitted entirely at zero: a household that never crosses a
 * surcharge threshold has no surcharge to caption, and "$0" on a card invites
 * the question the chapter exists to answer plainly.
 */
function medicareFacts(medicare: StoryFactsInput["medicare"]): Fact[] {
  if (!medicare) return [];
  const facts = [
    moneyFact("medicare.lifetime", "What Medicare costs, current plan", medicare.lifetime, MEDICARE_CHAPTERS),
  ];
  if (medicare.irmaa > 0) {
    facts.push(
      moneyFact("medicare.irmaa", "The higher-earner surcharge in that", medicare.irmaa, MEDICARE_CHAPTERS),
    );
  }
  return facts;
}

/**
 * The pack id holding the year of `goals[index]`.
 *
 * A goal's year is a four-digit number, and Gate 1 reads every four-digit number
 * on the page as a figure — so printing `StoryGoal.year` straight out of the
 * context would put an ungrounded figure in front of a client and make chapter
 * 1's narrator fail its own gate. It goes in the pack instead, and the narrator
 * reads it back through `factDisplay` like every other figure.
 *
 * Keyed by POSITION rather than by the goal's name, because a name is household
 * text that can repeat, be blank, or contain anything at all. The context and
 * this pack are built from one array in one function (`load-context.ts`), so the
 * positions cannot disagree — and `build-facts.test.ts` pins that pairing.
 */
export function goalYearFactId(index: number): string {
  return `goal.${index}.year`;
}

/**
 * One year fact per DATED goal, and nothing for an open-ended one.
 *
 * The label names the goal so the advisor reading the review panel can tell two
 * dates apart, and so the model knows which goal a year belongs to. It carries
 * the household's own text, exactly as a quoted strategy fact does — and like
 * those, it is long enough that Gate 5 treats it as distinctive, so a model that
 * recites it verbatim is caught.
 */
function goalYearFacts(goals: StoryGoal[]): Fact[] {
  return goals.flatMap((goal, index) =>
    goal.year == null
      ? []
      : [yearFact(goalYearFactId(index), `Goal date — ${goal.name}`, goal.year, GOAL_CHAPTERS)],
  );
}

export function buildStoryFacts(input: StoryFactsInput): Fact[] {
  const facts: Fact[] = [
    moneyFact("today.assets", "What you own", input.todayAssets, BALANCE_SHEET_CHAPTERS),
    moneyFact("today.debts", "What you owe", input.todayDebts, BALANCE_SHEET_CHAPTERS),
    moneyFact(
      "today.netWorth",
      "Net worth today",
      input.todayAssets - input.todayDebts,
      BALANCE_SHEET_CHAPTERS,
    ),
    moneyFact("today.liquid", "Money the plan can draw on", input.todayLiquid, BALANCE_SHEET_CHAPTERS),
    moneyFact(
      "outcome.legacy.base",
      "Left at the end, current plan",
      input.baseEndLiquid,
      OUTCOME_CHAPTERS,
    ),
    /**
     * The estate, tax, cover and Medicare figures sit AHEAD of the plan's own
     * years, and that is a layout decision as much as a data one: `figuresFor`
     * prints a `twoUp` chapter's first FIVE facts as the cards beside its prose,
     * and the estate chapter's scoped pack is six — four of its own plus the two
     * plan years every chapter can see. Behind the years, the card that falls
     * off the bottom is "Tax and costs on the estate, proposed plan", leaving
     * half a comparison on a page whose prose makes the whole one. Ahead of
     * them, what drops is the retirement year, which that chapter is not about.
     *
     * The cover chapter's pack is exactly five with a shortfall in it, so it has
     * no room to spare either.
     */
    ...estateFacts(input.estate),
    ...lifetimeTaxFacts(input.lifetimeTax),
    ...coverFacts(input.cover),
    ...medicareFacts(input.medicare),
    yearFact("plan.endOfLifeYear", "The last year we plan to", input.endOfLifeYear),
  ];

  /**
   * The retirement year, only while it is still ahead.
   *
   * `retirementYear` is `DOB year + retirementAge` with no clamp, so an
   * already-retired household carries a year in the past — 2013 on the Warner
   * fixture. Every consumer treats the label at face value ("the year you stop
   * working"), so the narrator wrote "From the year you stop working, 2013,
   * through 2051", which is simply false for someone who retired thirteen years
   * ago. Omitted rather than relabelled: a second label ("the year you retired")
   * is a second sentence shape in every narrator and every prompt, and none of
   * the chapters in this report has anything to say about it.
   */
  if (input.retirementYear >= input.planStartYear) {
    facts.push(yearFact("plan.retirementYear", "The year you stop working", input.retirementYear));
  }

  if (input.baseSuccess != null) {
    facts.push(
      pctFact("outcome.confidence.base", "Confidence, current plan", input.baseSuccess, OUTCOME_CHAPTERS),
    );
  }
  if (input.proposedSuccess != null) {
    facts.push(
      pctFact(
        "outcome.confidence.proposed",
        "Confidence, proposed plan",
        input.proposedSuccess,
        PROPOSED_OUTCOME_CHAPTERS,
      ),
    );
  }
  if (input.proposedEndLiquid != null) {
    facts.push(
      moneyFact(
        "outcome.legacy.proposed",
        "Left at the end, proposed plan",
        input.proposedEndLiquid,
        PROPOSED_OUTCOME_CHAPTERS,
      ),
    );
  }

  facts.push(...goalYearFacts(input.goals));

  /**
   * This year's flow. Three figures and deliberately NOT a fourth.
   *
   * What is left over is income minus the other two, and a rounded fourth total
   * that does not visibly subtract from three rounded ones is worse on a client
   * page than no total at all — "$2.4M in, $1.9M out, $300K saved, $235K left"
   * invites a subtraction that comes out wrong. The narrator states the
   * DIRECTION instead, compared on `raw`, which is what `raw` is for.
   */
  if (input.maxSpend.base != null) {
    facts.push(
      moneyFact(
        "spend.base",
        "What you could spend a year, current plan",
        input.maxSpend.base,
        SPEND_CHAPTERS,
      ),
    );
  }
  if (input.maxSpend.proposed != null) {
    facts.push(
      moneyFact(
        "spend.proposed",
        "What you could spend a year, proposed plan",
        input.maxSpend.proposed,
        SPEND_CHAPTERS,
      ),
    );
  }

  if (input.shortfallYear != null) {
    facts.push(
      yearFact(
        "base.shortfallYear",
        "The year the current plan runs short",
        input.shortfallYear,
        BASE_PATH_CHAPTERS,
      ),
    );
  }

  if (input.flow) {
    facts.push(
      moneyFact("flow.income", "Money coming in this year", input.flow.income, FLOW_CHAPTERS),
      moneyFact("flow.spending", "Money going out this year", input.flow.spending, FLOW_CHAPTERS),
      moneyFact("flow.saving", "What you're putting away", input.flow.saving, FLOW_CHAPTERS),
    );
  }

  // Last, and seeded with the plan figures' own spellings: a strategy that
  // quotes "$2.1M" needs no second entry, and the one it would have got would
  // have carried a vaguer label than "Net worth today".
  facts.push(...quoteStrategyFigures(input.strategies, new Set(facts.map((f) => f.display))));

  return facts;
}

/** Minimal shape needed to group — deliberately narrower than ScenarioChange
 *  so this module stays pure and trivially testable. */
export interface DescribedChange {
  change: { toggleGroupId?: string | null };
  row: ChangeRow;
}

/**
 * A strategy name derived from the change itself. `addRow` writes the WHAT
 * column as "+ Name" so the table can mark an addition at a glance; the deck
 * reads these names back as prose ("That comes from two changes: + Rental
 * income and …"), where the marker reads as a typo.
 *
 * Scoped to the add op, which is the only path that writes the marker, so an
 * account the household actually named "+Growth Fund" keeps its name.
 */
function nameFromRow(row: ChangeRow): string {
  return row.op === "add" ? row.what.replace(/^\+ /u, "") : row.what;
}

export function groupStrategies(
  described: DescribedChange[],
  toggleGroups: Array<{ id: string; name: string }>,
): StoryStrategy[] {
  const nameById = new Map(toggleGroups.map((g) => [g.id, g.name.trim()]));
  const byGroup = new Map<string, StoryStrategy>();
  // One pass, appending as each strategy is first seen, so the deck recommends
  // the changes in the order the Scenario Changes table lists them. Returning
  // every group ahead of every single change would put the deck's prose and the
  // table the client reads beside it in two different orders.
  const strategies: StoryStrategy[] = [];

  for (const { change, row } of described) {
    const gid = change.toggleGroupId;
    if (!gid) {
      strategies.push({ name: nameFromRow(row), rows: [row] });
      continue;
    }
    const existing = byGroup.get(gid);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    // A group id with no group behind it — or one whose label was left blank —
    // still names a real cluster of changes, so the rows stay together and the
    // card borrows the first change's name. The literal word "Strategy" is
    // client-facing text that names nothing.
    const strategy: StoryStrategy = { name: nameById.get(gid) || nameFromRow(row), rows: [row] };
    byGroup.set(gid, strategy);
    strategies.push(strategy);
  }

  return strategies;
}
