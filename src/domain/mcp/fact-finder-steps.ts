// src/domain/mcp/fact-finder-steps.ts
//
// The onboarding steps Claude builds a household in. Each step is one fact
// finder import over a fixed set of sections (spec §4); `describeStep` is what
// Claude reads to fill one: the sections' columns, the draft's rows, and the
// household's records those rows are matched against. Pure — the tools in
// tools/household-building.ts do the IO.
//
// Not under the terminology test's allowlisted `tools/` prefix: text here names
// "the second person" rather than either word for them.
import type { TargetKind } from "@/lib/fact-finder/change-set";
import type { BookRecord, RecordBook } from "@/lib/fact-finder/placement/types";
import {
  FACT_FINDER_SECTIONS,
  findSection,
  fixedLabelsOf,
  type ColumnKind,
  type FFLayout,
  type FFSection,
} from "@/lib/fact-finder/schema";
import { fixedLabelOfRow, linkNeedsClick, rowHasValues, rowLabel, rowValues } from "@/lib/fact-finder/state";
import type { FactFinderState, FFCellValue, FFRow } from "@/lib/fact-finder/types";

export const FACT_FINDER_STEP_IDS = [
  "household",
  "balance_sheet",
  "real_estate",
  "income",
  "savings",
  "goals",
  "living_expenses",
  "insurance",
  "estate",
] as const;
export type FactFinderStepId = (typeof FACT_FINDER_STEP_IDS)[number];

export interface FactFinderStep {
  id: FactFinderStepId;
  label: string;
  sectionIds: readonly string[];
  /**
   * The existing records the step's rows describe. Where a section links, the
   * record its rows link to (an annuity row's account, an equity row's grant),
   * never a second view of the same record.
   */
  targets: readonly TargetKind[];
  /** Narrows a target to the records this step holds; a target without one shows all of its records. */
  keep?: Partial<Record<TargetKind, (record: BookRecord) => boolean>>;
  /** What the step's fields mean, for the model filling them. */
  guidance: string;
}

const isRealEstate = (r: BookRecord) => r.facts?.category === "real_estate";

/** Dan's order. Every fact finder section but `meta` is in exactly one step. */
export const FACT_FINDER_STEPS: readonly FactFinderStep[] = [
  {
    id: "household",
    label: "Household",
    sectionIds: ["people", "household", "family", "external"],
    targets: ["client_household", "family_member", "external_beneficiary"],
    guidance:
      "people holds the client and the second person (fixed rows), household the filing status and address, family the children, grandchildren and other heirs, and external the charities and other beneficiaries outside the family.",
  },
  {
    id: "balance_sheet",
    label: "Balance sheet",
    sectionIds: ["cash", "taxable", "retirement", "annuity", "edu", "equity", "notes_rec", "liab"],
    targets: ["account", "stock_option_grant", "note_receivable", "liability"],
    keep: { account: (r) => !isRealEstate(r) && r.facts?.category !== "business" },
    guidance:
      "One row per account, annuity, education account, equity grant, note receivable and debt, each with its current value; a retirement account's ongoing contributions belong in the savings step.",
  },
  {
    id: "real_estate",
    label: "Real estate",
    sectionIds: ["realestate", "business"],
    targets: ["account", "business_account"],
    keep: { account: isRealEstate },
    guidance:
      "Each property's annual property tax goes in its row; a mortgage from the balance sheet links to its property.",
  },
  {
    id: "income",
    label: "Income",
    sectionIds: ["salary", "ss", "income"],
    targets: ["income"],
    guidance:
      "Each person's salary, Social Security from a statement or an estimate the advisor gives, and other income such as pensions, deferred compensation, rental and trust distributions.",
  },
  {
    id: "savings",
    label: "Savings",
    sectionIds: ["savings"],
    targets: ["savings_rule"],
    guidance: "Each row is one ongoing contribution; its account column names an account from the balance sheet step.",
  },
  {
    id: "goals",
    label: "Goals",
    sectionIds: ["expenses"],
    targets: ["expense"],
    // The expenses section holds goals and every other expense outside living expenses.
    keep: { expense: (r) => r.facts?.type !== "living" },
    guidance:
      "Each row is an expense outside living expenses, such as education, travel, a large purchase or care for a parent, with an annual amount and the years it starts and ends; isGoal marks a goal.",
  },
  {
    id: "living_expenses",
    label: "Living expenses",
    sectionIds: ["living", "living_items"],
    targets: ["expense"],
    keep: { expense: (r) => r.facts?.type === "living" },
    guidance:
      "Living expenses are what the household spends after taxes, property taxes, insurance premiums, debt payments and the goals listed separately. When a figure includes any of those, take them out and say which.",
  },
  {
    id: "insurance",
    label: "Insurance",
    sectionIds: ["life", "disability", "ltc", "insurance_notes"],
    targets: ["life_insurance_policy", "disability_policy", "ltc_policy"],
    guidance:
      "One row per life, disability and long-term care policy; group or employer coverage without a policy of its own goes in the notes.",
  },
  {
    id: "estate",
    label: "Estate",
    sectionIds: ["estate_docs", "trusts", "bequests", "gifts", "final_notes"],
    targets: ["entity", "revocable_trust", "will", "gift"],
    guidance:
      "The documents each person has in place, trusts, will provisions and prior lifetime gifts; account beneficiaries are columns on each account's row in the balance sheet step.",
  },
];

export interface StepSectionView {
  id: string;
  label: string;
  hint?: string;
  layout: FFLayout;
  /** The labels a fill names in `fixedRow`. */
  fixedRows?: string[];
  columns: { id: string; label: string; kind: ColumnKind; options?: readonly string[] }[];
}

/** A draft row's "Links to": an existing record (unconfirmed = waiting on the advisor), a new record, or not scored yet. */
export type DraftRowLink = { recordId: string; score: number | null; confirmed: boolean } | "new" | null;

export interface DraftRow {
  sectionId: string;
  rowId: string;
  fixedRow?: string;
  cells: Record<string, FFCellValue>;
  link: DraftRowLink;
}

export interface DecisionRow {
  sectionId: string;
  rowId: string;
  label: string;
  candidates: { recordId: string; label: string; score: number }[];
}

export interface StepView {
  step: { id: FactFinderStepId; label: string; guidance: string };
  sections: StepSectionView[];
  draftRows: DraftRow[];
  existingRecords: { target: TargetKind; recordId: string; label: string; seeded?: true }[];
}

export function factFinderStep(id: FactFinderStepId): FactFinderStep {
  const step = FACT_FINDER_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`unknown fact finder step ${id}`);
  return step;
}

function sectionOf(id: string): FFSection {
  const section = findSection(id);
  if (!section) throw new Error(`unknown fact finder section ${id}`);
  return section;
}

function sectionView(section: FFSection): StepSectionView {
  const fixedRows = fixedLabelsOf(section);
  return {
    id: section.id,
    label: section.label,
    ...(section.hint ? { hint: section.hint } : {}),
    layout: section.layout,
    ...(fixedRows.length > 0 ? { fixedRows: [...fixedRows] } : {}),
    columns: section.columns.map(({ id, label, kind, options }) => ({ id, label, kind, ...(options ? { options } : {}) })),
  };
}

function linkView(row: FFRow): DraftRowLink {
  if (!row.link) return null;
  if (row.link.kind === "new") return "new";
  return { recordId: row.link.recordId, score: row.link.score, confirmed: row.link.confirmed };
}

/**
 * The draft's rows in these sections, with their filled cells and links. A
 * fixed row nothing has touched is left out, and so is a section id the fact
 * finder doesn't have (a fill can name one; its ops are refused on their own).
 */
export function draftRows(state: FactFinderState, sectionIds: Iterable<string>): DraftRow[] {
  return [...sectionIds].flatMap((sectionId) => {
    const section = findSection(sectionId);
    if (!section) return [];
    return (state.sections[sectionId] ?? []).flatMap((row): DraftRow[] => {
      const label = fixedLabelOfRow(sectionId, row.id);
      const fixed = label !== null && fixedLabelsOf(section).includes(label);
      if (fixed && !rowHasValues(row) && !row.link) return [];
      return [
        { sectionId, rowId: row.id, ...(fixed ? { fixedRow: label } : {}), cells: rowValues(row), link: linkView(row) },
      ];
    });
  });
}

/**
 * Rows anywhere in the draft whose link waits on the advisor: matched to a
 * record, but not surely enough to confirm. Plus the rows in `named` (the ones
 * a review refused over), whatever their link.
 */
export function rowsNeedingDecision(state: FactFinderState, named: readonly string[] = []): DecisionRow[] {
  const also = new Set(named);
  return FACT_FINDER_SECTIONS.flatMap((section) =>
    (state.sections[section.id] ?? []).filter((row) => linkNeedsClick(row) || also.has(row.id)).map((row) => ({
      sectionId: section.id,
      rowId: row.id,
      label: rowLabel(section, row),
      candidates: (row.linkCandidates ?? []).map(({ recordId, label, score }) => ({ recordId, label, score })),
    })),
  );
}

/** What a new plan is created with: the $0 "Household Cash" account, the two default living rows, $0 Social Security. */
function isSeeded(target: TargetKind, r: BookRecord): boolean {
  switch (target) {
    case "account":
      return r.facts?.isDefaultChecking === true;
    case "expense":
      return r.facts?.livingSlot != null;
    case "income":
      return r.facts?.type === "social_security" && (r.values.piaMonthly ?? 0) === 0;
    default:
      return false;
  }
}

export function describeStep(stepId: FactFinderStepId, state: FactFinderState, book: RecordBook): StepView {
  const step = factFinderStep(stepId);
  return {
    step: { id: step.id, label: step.label, guidance: step.guidance },
    sections: step.sectionIds.map((id) => sectionView(sectionOf(id))),
    draftRows: draftRows(state, step.sectionIds),
    existingRecords: step.targets.flatMap((target) =>
      book.records[target]
        .filter((r) => step.keep?.[target]?.(r) ?? true)
        .map((r) => ({ target, recordId: r.id, label: r.label, ...(isSeeded(target, r) ? { seeded: true as const } : {}) })),
    ),
  };
}
