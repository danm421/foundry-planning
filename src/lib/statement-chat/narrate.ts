import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import type { MergeDecision } from "@/lib/imports/assemble/decisions";
import type { RebaseOverride, RebaseRefusal } from "./rebase";

/**
 * Deterministic narration of what a statement import found. Every sentence
 * below is produced by a rule reading a `MergeDecision` or a row field —
 * there is no model call and no free text, so the prose can never claim
 * something the merge did not actually establish (see the task's brief).
 *
 * Direction rule: this module reads from `@/lib/imports/`, never the
 * reverse — `MergeDecision` is Task 3's type, imported read-only.
 */

/**
 * `iso` is `YYYY-MM-DD` for every decision the merge itself produces —
 * `mergeAcrossFiles` only ever records dates that passed `orderableDate()`
 * (zero-padded ISO). Splitting on "-" is therefore safe for decisions that
 * came from the merge. This function adds no defensive re-parsing; a
 * decision arriving from anywhere else is out of contract for this module.
 */
function usDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Oxford-comma join: ["a"] -> "a"; ["a","b"] -> "a and b"; ["a","b","c"] -> "a, b, and c". */
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * The clause describing "no readable date" for N source files. `n` is
 * always the DISTINCT file-name count `mergeAcrossFiles` recorded (Ruling
 * 34): a single document listing the same account twice collapses with
 * `fileNames.length === 1`, so "on either" — which presupposes exactly two
 * — must not render for that case, nor for three or more files.
 */
function noDateClause(n: number): string {
  if (n === 1) return "with no readable date";
  if (n === 2) return "with no readable date on either";
  return "with no readable date on any of them";
}

function supersededSentence(d: Extract<MergeDecision, { kind: "superseded" }>): string {
  const kept = `Used the ${usDate(d.kept)} statement for "${d.account}";`;
  if (d.dropped.length === 1) {
    return `${kept} a ${usDate(d.dropped[0])} statement for the same account was superseded.`;
  }
  return `${kept} statements from ${joinWithAnd(d.dropped.map(usDate))} for the same account were superseded.`;
}

function rollupCaveat(d: Extract<MergeDecision, { kind: "rollup-excluded" }>): string {
  // C3 / Ruling 32: `coversCount` names how many sibling rows are already
  // listed — it is NOT a claim that the total's arithmetic reconciles with
  // them. Do not reword this to imply reconciliation.
  return `Excluded "${d.label}" (${money(d.value)}) — it is a total covering ${d.coversCount} accounts already listed.`;
}

function undatedCaveat(d: Extract<MergeDecision, { kind: "undated" }>): string {
  return (
    `"${d.account}" appeared in ${joinWithAnd(d.fileNames)} ${noDateClause(d.fileNames.length)} — ` +
    `the more complete row was used instead of the more recent one.`
  );
}

/**
 * C2 said not to attribute a figure to a named FILE — it did not license
 * dating every figure to one statement. `asOf` is the SURVIVING row's date
 * only; the other figures in `d.values` came from other statements on other
 * dates this decision does not carry. Only `d.kept` — the winning figure —
 * may be paired with `asOf`; the rest are named without a date.
 *
 * `d.kept` is read directly off the decision rather than re-derived here.
 * An earlier version of this function matched `d.account` (a bare display
 * name) back against `rows` to find "the winner" — but two different
 * accounts can share a name (a client IRA and a spouse IRA, say), so that
 * lookup could silently resolve to the WRONG account's row and fabricate a
 * figure that appears nowhere in the actual conflict. `merge-across-files.ts`
 * now reads the survivor's own figure at the moment it emits the decision,
 * when there is no ambiguity about which row it is — the narrator should
 * never have to re-derive a fact the decision log already recorded. The
 * emit guard also requires `kept !== undefined`, so a `value-conflict`
 * decision with no identifiable winner cannot reach this function; there is
 * no fallback branch because that state is unrepresentable.
 */
function valueConflictCaveat(d: Extract<MergeDecision, { kind: "value-conflict" }>): string {
  const others = d.values.filter((v) => v !== d.kept);
  const othersClause =
    others.length === 1
      ? `another statement reported ${money(others[0])}`
      : `other statements reported ${joinWithAnd(others.map(money))}`;
  return `"${d.account}" is recorded at ${money(d.kept)} from the ${usDate(d.asOf)} statement; ${othersClause}.`;
}

/**
 * `money()` for a figure that may not exist. A row with no readable balance
 * is an ordinary extraction outcome, and the one thing this caveat must never
 * do is invent a number to fill the gap.
 */
function moneyOrNone(n: number | undefined): string {
  return n === undefined ? "no value" : money(n);
}

/**
 * Ruling 117. The advisor's standing figure won a re-extraction; say so, and
 * name the figure it beat. Both numbers appear, and the sentence is explicit
 * about which of them is the one on screen — the failure this replaces was a
 * table reading $100,000 under a caveat naming $130,000.
 *
 * It closes with what to DO, because there is a real decision here: the newer
 * statement may well be the figure the advisor wants, and the only way to
 * take it is to edit the row.
 */
function rebaseOverrideCaveat(o: RebaseOverride): string {
  return (
    `"${o.name}" is shown at ${moneyOrNone(o.standingValue)} — the figure already on this import, ` +
    `and the one that will commit. The newly uploaded statement reports ${moneyOrNone(o.freshValue)}. ` +
    `Edit the row if the newer figure is the one you want.`
  );
}

/**
 * Final review #2, C-1. The rebase refused to carry a standing row forward
 * because the row now holding its handle is a different account. Nothing was
 * overwritten — which is the whole point — but the advisor's work on that row
 * was not applied either, and a silent non-application is indistinguishable
 * from a dead button.
 *
 * Both names are printed: the label the advisor has been looking at, and the
 * account that now occupies that row. It closes with what to DO, the same
 * shape `rebaseOverrideCaveat` uses, because re-applying the change on the
 * right row is the only way forward.
 */
function rebaseRefusalCaveat(r: RebaseRefusal): string {
  return (
    `Your changes to "${r.name}" were not carried onto the re-read statements: after the new ` +
    `upload that row's place is held by a different account, "${r.freshName}". Nothing was ` +
    `overwritten — re-apply the change on the row you want.`
  );
}

/**
 * True when this `value-conflict` decision is describing a merge result the
 * rebase then threw away — its headline figure (`kept`) is not on the table,
 * so `valueConflictCaveat` would print "is recorded at $130,000" directly
 * above a row reading $100,000. The override caveat carries the same two
 * numbers honestly, so this one is dropped rather than reworded.
 *
 * The join is an account NAME **and** the discarded figure, not the name
 * alone. `valueConflictCaveat`'s own docstring records why a bare name is
 * not an identity here — two accounts can share a display name — and
 * `MergeDecision` carries no `__rowId` to join on properly. Requiring
 * `kept === freshValue` makes a name collision harmless: a same-named
 * account is only muted when its surviving figure is exactly the one the
 * rebase held back, which is the case this is for. The residual risk is
 * over-suppression when two same-named accounts also merged to the same
 * figure — that is silence, never a fabricated number, and the override
 * caveat still names both figures for the row that was actually overridden.
 *
 * EITHER name matches (Ruling 128). `d.account` is the FRESH survivor's
 * name; `o.name` is the STANDING row's. `name` is editable and a rename
 * survives the rebase, so after the advisor renames a row those two stop
 * being the same string and a name-only join silently misses — which
 * re-opened the exact Critical this function exists to close, in the rename
 * case. `o.freshName` carries the fresh spelling alongside, and matching
 * either one restores the join. The `freshValue === kept` half is untouched,
 * so widening the name side does not widen the suppression to same-named
 * accounts with different figures.
 */
function contradictsRebase(
  d: Extract<MergeDecision, { kind: "value-conflict" }>,
  overrides: RebaseOverride[],
): boolean {
  return overrides.some(
    (o) => (o.name === d.account || o.freshName === d.account) && o.freshValue === d.kept,
  );
}

function retirementBasisCaveat(rows: Annotated<ExtractedAccount>[]): string | null {
  const flagged = rows.filter((r) => r.basis !== undefined && r.category === "retirement");
  if (flagged.length === 0) return null;
  return `For ${joinWithAnd(flagged.map((r) => `"${r.name}"`))}, the basis shown is the custodian's securities cost basis, not IRS-tracked basis for tax purposes.`;
}

/**
 * The only caveat that describes what COMMITTING will do to the plan
 * already on file, rather than what was read off the statements. A row
 * carries `match: { kind: "exact" }` once the matching step (elsewhere in
 * `lib/imports`) has linked it to an existing plan account — `mergeAcrossFiles`
 * itself stamps every row `{ kind: "new" }`, so this stays silent until
 * matching has actually run on this surface, and fires again on a
 * re-narrated committed row (`linkCreated` sets the same `exact` match after
 * commit — see `src/lib/imports/types.ts`). An advisor who misses this could
 * overwrite a real account believing they were adding a new one, so it does
 * not wait for a decision — `match` is a row field like `basis`/`category`.
 */
function matchedCaveat(rows: Annotated<ExtractedAccount>[]): string | null {
  const matched = rows.filter((r) => r.match?.kind === "exact");
  if (matched.length === 0) return null;
  return matched.length === 1
    ? "1 account matched an existing plan account and will update it rather than create a new one."
    : `${matched.length} accounts matched existing plan accounts and will update them rather than create new ones.`;
}

export interface Narration {
  summary: string;
  caveats: string[];
}

export function narrate(input: {
  fileCount: number;
  decisions: MergeDecision[];
  rows: Annotated<ExtractedAccount>[];
  /**
   * Rows whose freshly-merged figure the rebase held back (Ruling 117).
   * Optional and defaulted rather than required: only a RE-extraction can
   * produce any, so the first read of an import has none by construction and
   * the caller would be threading a permanent `[]` through.
   */
  overrides?: RebaseOverride[];
  /**
   * Standing rows the rebase REFUSED to carry forward (final review #2,
   * C-1). Optional and defaulted for the same reason as `overrides`: only a
   * re-extraction can produce any.
   */
  refusals?: RebaseRefusal[];
}): Narration {
  const { fileCount, decisions, rows, overrides = [], refusals = [] } = input;

  const sentences: string[] = [
    `Read ${fileCount} ${plural(fileCount, "statement", "statements")} covering ${rows.length} ${plural(rows.length, "account", "accounts")}.`,
  ];
  const caveats: string[] = [];

  for (const d of decisions) {
    switch (d.kind) {
      case "superseded":
        // `basis: "field-count"` means the winner was picked by field
        // richness, not recency — "Used the X statement" would misstate
        // WHY it won, so that case says nothing (mergeAcrossFiles never
        // actually emits it today; the guard exists because the type
        // allows it).
        if (d.basis === "date") sentences.push(supersededSentence(d));
        break;
      case "rollup-excluded":
        caveats.push(rollupCaveat(d));
        break;
      case "undated":
        caveats.push(undatedCaveat(d));
        break;
      case "value-conflict":
        // Suppressed HERE rather than in the route: "never name a figure the
        // table does not show" is this module's own contract, so every caller
        // gets it — not only the one route that remembered to pre-filter.
        if (!contradictsRebase(d, overrides)) caveats.push(valueConflictCaveat(d));
        break;
    }
  }

  for (const o of overrides) caveats.push(rebaseOverrideCaveat(o));
  for (const r of refusals) caveats.push(rebaseRefusalCaveat(r));

  const retirementCaveat = retirementBasisCaveat(rows);
  if (retirementCaveat) caveats.push(retirementCaveat);

  const matched = matchedCaveat(rows);
  if (matched) caveats.push(matched);

  return { summary: sentences.join(" "), caveats };
}
