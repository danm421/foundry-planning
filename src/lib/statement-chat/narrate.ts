import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import type { MergeDecision } from "@/lib/imports/assemble/decisions";

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
 * C2: `values` is collected from the running MERGED row, not any single
 * file's original figure — on the third-and-later file, the first entry is
 * the survivor's value at that point, not a specific document's number.
 * The copy therefore states both figures and the as-of date without
 * attributing either one to a named file.
 */
function valueConflictCaveat(d: Extract<MergeDecision, { kind: "value-conflict" }>): string {
  return `"${d.account}" has been reported at ${joinWithAnd(d.values.map(money))} as of ${usDate(d.asOf)} — confirm which figure is current.`;
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
}): Narration {
  const { fileCount, decisions, rows } = input;

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
        caveats.push(valueConflictCaveat(d));
        break;
    }
  }

  const retirementCaveat = retirementBasisCaveat(rows);
  if (retirementCaveat) caveats.push(retirementCaveat);

  const matched = matchedCaveat(rows);
  if (matched) caveats.push(matched);

  return { summary: sentences.join(" "), caveats };
}
