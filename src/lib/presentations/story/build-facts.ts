// Pure. Turns already-loaded plan figures into the fact pack, and already-
// described scenario changes into named strategies. No IO, no clock — the
// caller (load-context.ts) owns both.
import type { ChangeRow } from "@/lib/presentations/pages/scenario-changes/types";
import { moneyFact, pctFact, quotedFact, yearFact, type Fact } from "./facts";
import type { StoryStrategy } from "./types";
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
  /**
   * The grouped changes, from `groupStrategies`. Required rather than optional
   * on purpose: the recommendation chapter prints these rows' own text, and it
   * prints nothing but a generic clause unless their figures are in the pack.
   * A caller that forgot to pass them would silently rebuild the defect this
   * argument exists to close, so the compiler asks for them.
   */
  strategies: StoryStrategy[];
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
 * Deduplicated on `display`, which is the only thing anything compares here, so
 * ids stay unique by construction. The dedupe is case-SENSITIVE deliberately:
 * "$25k" and "$25K" are one value in two spellings, and the gate accepts only
 * the spelling actually written.
 */
function quoteStrategyFigures(strategies: StoryStrategy[], taken: Set<string>): Fact[] {
  const facts: Fact[] = [];
  for (const strategy of strategies) {
    for (const row of strategy.rows) {
      for (const text of [...row.detail, row.before, row.after]) {
        for (const token of extractFigures(text)) {
          if (taken.has(token)) continue;
          taken.add(token);
          // The label names the strategy the token was FIRST seen in — a figure
          // shared by two changes is one entry, under the earlier one.
          facts.push(
            quotedFact(`quoted.${token}`, `${strategy.name} — figure quoted from the change list`, token),
          );
        }
      }
    }
  }
  return facts;
}

export function buildStoryFacts(input: StoryFactsInput): Fact[] {
  const facts: Fact[] = [
    moneyFact("today.assets", "What you own", input.todayAssets),
    moneyFact("today.debts", "What you owe", input.todayDebts),
    moneyFact("today.netWorth", "Net worth today", input.todayAssets - input.todayDebts),
    moneyFact("today.liquid", "Money the plan can draw on", input.todayLiquid),
    moneyFact("outcome.legacy.base", "Left at the end, current plan", input.baseEndLiquid),
    yearFact("plan.retirementYear", "The year you stop working", input.retirementYear),
    yearFact("plan.endOfLifeYear", "The last year we plan to", input.endOfLifeYear),
  ];

  if (input.baseSuccess != null) {
    facts.push(pctFact("outcome.confidence.base", "Confidence, current plan", input.baseSuccess));
  }
  if (input.proposedSuccess != null) {
    facts.push(pctFact("outcome.confidence.proposed", "Confidence, proposed plan", input.proposedSuccess));
  }
  if (input.proposedEndLiquid != null) {
    facts.push(moneyFact("outcome.legacy.proposed", "Left at the end, proposed plan", input.proposedEndLiquid));
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
