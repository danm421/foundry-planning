import type { ImportPayload } from "@/lib/imports/types";
import type { AssembleAssumption, AssembleQuestion, AssembleQuestionKind } from "./types";

export interface GenerateQuestionsInput {
  payload: ImportPayload;
  assumptions: AssembleAssumption[];
  mode: "new" | "existing";
  primaryDobKnown: boolean;
}

/** Upper bound on the advisor-facing question list — a target-cap, not a floor. */
export const MAX_QUESTIONS = 8;

/** Rule 3 contributes at most this many conflict questions, independent of MAX_QUESTIONS. */
const MAX_CONFLICT_QUESTIONS = 3;

/** Candidate ages offered alongside the assumed retirement age. */
const RETIREMENT_AGE_CANDIDATES = [60, 62, 65, 67, 70];

/** Candidate filing statuses offered alongside the assumed one. */
const FILING_STATUS_CANDIDATES = ["single", "married_joint", "married_separate", "head_of_household"];

const KIND_PRIORITY: Record<AssembleQuestionKind, number> = {
  identity: 0,
  conflict: 1,
  assumption: 2,
  missing: 3,
};

/** Turn a dotted field path's last segment into a `snake_case` slug for stable ids. */
function slugifyField(field: string): string {
  const segment = field.split(".").pop() ?? field;
  return segment.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Turn free text (e.g. an entity name) into a stable, id-safe slug. */
function slugifyText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

/**
 * Build the "<value> (assumed)" option plus the fixed candidate list, with
 * the assumed value's own entry (if it also appears verbatim in the
 * candidates) removed so it isn't offered twice.
 */
function optionsWithAssumedFirst(assumedValue: string | number, candidates: Array<string | number>): string[] {
  const assumedLabel = `${assumedValue} (assumed)`;
  const rest = candidates.filter((c) => String(c) !== String(assumedValue)).map((c) => String(c));
  return [assumedLabel, ...rest];
}

/**
 * Rule 1: for a brand-new prospect whose primary date of birth is neither
 * confirmed by the caller nor already present in the merged payload, ask
 * for it — the plan can't be built without it.
 */
function identityQuestions(input: GenerateQuestionsInput): AssembleQuestion[] {
  const { payload, mode, primaryDobKnown } = input;
  if (mode !== "new") return [];
  if (primaryDobKnown) return [];
  if (payload.primary?.dateOfBirth) return [];

  return [
    {
      id: "q:primary_dob",
      kind: "identity",
      field: "client.primaryDob",
      prompt: "What's the primary client's date of birth? (needed to build the plan)",
    },
  ];
}

/**
 * Rule 2: every gap-fill assumption on retirement age or filing status is
 * worth a quick confirm — these drive tax brackets and retirement-year
 * math, so a wrong default is expensive to leave unquestioned. Other
 * assumed fields (e.g. life expectancy) stay silent; they surface as
 * review-wizard flags instead.
 */
function assumptionQuestions(assumptions: AssembleAssumption[]): AssembleQuestion[] {
  const questions: AssembleQuestion[] = [];

  for (const assumption of assumptions) {
    if (assumption.field === "client.retirementAge") {
      questions.push({
        id: `q:${slugifyField(assumption.field)}`,
        kind: "assumption",
        field: assumption.field,
        prompt: `We assumed a retirement age of ${assumption.value} — is that right?`,
        options: optionsWithAssumedFirst(assumption.value, RETIREMENT_AGE_CANDIDATES),
      });
    } else if (assumption.field === "client.filingStatus") {
      questions.push({
        id: `q:${slugifyField(assumption.field)}`,
        kind: "assumption",
        field: assumption.field,
        prompt: `We assumed a filing status of "${assumption.value}" — is that right?`,
        options: optionsWithAssumedFirst(assumption.value, FILING_STATUS_CANDIDATES),
      });
    }
  }

  return questions;
}

/**
 * Rule 3: a "Merged duplicate ..." warning means two source files disagreed
 * on the same entity and the merge step had to pick one row's conflicting
 * fields over the other's. Surface up to MAX_CONFLICT_QUESTIONS of those as
 * questions; the rest still show up as review-wizard flags. Fuzzy
 * near-duplicate matches (a separate warning shape) are intentionally left
 * out — that reconciliation belongs to the review wizard, not this list.
 */
function conflictQuestions(payload: ImportPayload): AssembleQuestion[] {
  const questions: AssembleQuestion[] = [];

  for (const warning of payload.warnings) {
    if (questions.length >= MAX_CONFLICT_QUESTIONS) break;
    if (!warning.includes("Merged duplicate")) continue;

    const match = /^Merged duplicate (\S+) "([^"]+)"/.exec(warning);
    const label = match?.[1] ?? "item";
    const name = match?.[2];
    const idSuffix = name ? slugifyText(name) : String(questions.length);

    questions.push({
      id: `q:conflict:${slugifyText(label)}:${idSuffix}`,
      kind: "conflict",
      field: `merge.${label}`,
      prompt: name
        ? `We merged duplicate ${label} entries for "${name}" found across your source files — please confirm the combined values are correct.`
        : `We merged duplicate ${label} entries found across your source files — please confirm the combined values are correct.`,
    });
  }

  return questions;
}

/**
 * Turns genuine gaps/conflicts surfaced during assembly into a short,
 * advisor-facing question list (capped at MAX_QUESTIONS). Only rules 1-3
 * below ever produce a question — an assumption on a field none of them
 * cover, or a warning that isn't a merge conflict, contributes nothing.
 * An empty result is valid and expected when nothing needs asking.
 *
 * Pure and deterministic: no Math.random, no Date.now, no IO. Question
 * ids are fixed strings or slugs of the field/warning that produced them,
 * so the same input always yields the same output.
 */
export function generateQuestions(input: GenerateQuestionsInput): AssembleQuestion[] {
  const questions: AssembleQuestion[] = [
    ...identityQuestions(input),
    ...conflictQuestions(input.payload),
    ...assumptionQuestions(input.assumptions),
  ];

  // Stable sort: within a kind, rule order (and, for conflicts, warning
  // order) is preserved — only the kind priority reorders across groups.
  questions.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);

  // Belt-and-braces: `AssembleQuestion.id`'s type comment promises stable,
  // UNIQUE ids (PlanQuestionsCard keys + <label htmlFor> + answers[q.id] all
  // depend on that). merge-across-files.ts now emits one "Merged duplicate"
  // warning per entity (not per merge — see its FIX 6 comment), which is the
  // real fix for the duplicate-id case; this dedupe is cheap insurance
  // against any future rule producing a colliding id.
  const seenIds = new Set<string>();
  const deduped = questions.filter((q) => {
    if (seenIds.has(q.id)) return false;
    seenIds.add(q.id);
    return true;
  });

  return deduped.slice(0, MAX_QUESTIONS);
}
