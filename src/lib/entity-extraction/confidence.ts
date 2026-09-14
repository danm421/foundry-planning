import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow, Observation } from "./types";

/** Below this, a cell is marked for review in the table. */
export const REVIEW_THRESHOLD = 0.7;

/** A value that failed coercion, an enum or a range check cannot be trusted. */
const INVALID_CAP = 0.3;
/** A value whose snippet is not in the document may have been invented. */
const UNGROUNDED_CAP = 0.5;

/** PDF extraction breaks lines where the model does not. Compare on the words. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isGrounded(snippet: string | null, haystack: string): boolean {
  if (!snippet) return false;
  const needle = normalize(snippet);
  if (!needle) return false;
  return haystack.includes(needle);
}

/**
 * Clamp each value's model-emitted confidence by what can actually be checked,
 * then score the row.
 *
 * These checks only ever LOWER a score. That is the whole point: a language
 * model will return 0.9 for a figure it invented, so the number is only worth
 * showing to an advisor if a fact can pull it down.
 */
export function scoreRow(args: {
  entity: DetailEntity;
  row: CandidateRow;
  documentText: string;
}): CandidateRow {
  const { entity, row, documentText } = args;
  const haystack = normalize(documentText);

  const values: Observation[] = row.values.map((value) => {
    let confidence = value.confidence;
    let issue = value.issue;

    if (issue) {
      confidence = Math.min(confidence, INVALID_CAP);
    } else if (!isGrounded(value.snippet, haystack)) {
      issue = "ungrounded";
      confidence = Math.min(confidence, UNGROUNDED_CAP);
    }

    return { ...value, confidence, issue };
  });

  // The row is only as good as the fields that decide whether it can be
  // written and which existing row it is. An optional field nobody relies on
  // must not drag the row's score down.
  const load = new Set<string>([
    ...entity.fields.filter((f) => f.required).map((f) => f.key),
    ...(entity.identity ?? []),
  ]);
  const loadBearing = values.filter((v) => load.has(v.key));
  const rowConfidence = loadBearing.length
    ? Math.min(...loadBearing.map((v) => v.confidence))
    : 0;

  return { ...row, values, rowConfidence };
}
