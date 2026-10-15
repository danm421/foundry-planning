// src/lib/fact-finder/placement/place.ts
/**
 * The placement runner (D4, D5): every live row of every section through its
 * map. Before a map sees a row, its notes go to the AI step and every cell
 * that didn't fit its column comes out — a choice that isn't one of the
 * options blocks the lines its column feeds (a missing choice can change what
 * a line means), any other value goes to the AI step and the line is placed
 * without it. A row linked to another kind of account — a business, or an
 * account of another category — is blocked whole. Pure.
 */
import { cellKey, type CellRef, type TargetKind } from "../change-set";
import { SECTION_ACCOUNT_CATEGORY } from "../enums";
import { FACT_FINDER_SECTIONS, type FFColumn, type FFPage, type FFSection, type RecordKind } from "../schema";
import { fixedRow, isBlank, rowHasValues, rowLabel } from "../state";
import type { FactFinderState, FFCellValue, FFRow } from "../types";
import { text } from "./map/helpers";
import { sectionMapFor } from "./map/index";
import type { PlaceContext, SectionMap } from "./map/types";
import { buildRefIndex } from "./refs";
import { findRecord, type LeftoverItem, type NoteTopic, type RecordBook, type TargetDraft } from "./types";

export interface Placed {
  drafts: TargetDraft[];
  leftovers: LeftoverItem[];
  notices: string[];
}

/**
 * The book targets a "Links to" of each record kind can name. Plan 2's matcher
 * offers an account section's row both kinds of account record, so D11 accepts
 * either; the review's link check (Task 19) reads the same pools.
 */
export const LINK_TARGETS: Readonly<Record<RecordKind, readonly TargetKind[]>> = {
  account: ["account", "business_account"],
  liability: ["liability"],
  familyMember: ["family_member"],
  externalBeneficiary: ["external_beneficiary"],
  income: ["income"],
  expense: ["expense"],
  savingsRule: ["savings_rule"],
  lifePolicy: ["life_insurance_policy"],
  disabilityPolicy: ["disability_policy"],
  ltcPolicy: ["ltc_policy"],
  entity: ["entity"],
  gift: ["gift"],
  stockOptionGrant: ["stock_option_grant"],
  noteReceivable: ["note_receivable"],
};

/** Where the AI step files a value that didn't fit, by page. */
const UNFIT_TOPIC: Record<FFPage, NoteTopic> = {
  household: "general",
  accounts: "investments",
  realEstateDebts: "cash-flow",
  income: "cash-flow",
  expensesSavings: "cash-flow",
  insurance: "insurance",
  estate: "estate",
};

/** Longer than this, a text cell is unfit: no reader or prompt takes it whole (a megabyte cell would pin the review). */
const CELL_MAX = 2_000;

/** A value of the column's kind, as the readers and every edit store it (normalize.ts). */
function fits(column: FFColumn, value: FFCellValue): boolean {
  switch (column.kind) {
    case "text":
    case "notes":
      return typeof value === "string";
    case "money":
    case "number":
    case "percent":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "year":
      return typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2200;
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "monthYear":
      return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
    case "choice":
      return typeof value === "string" && (column.options ?? []).includes(value);
    case "check":
      return typeof value === "boolean";
  }
}

/** A cell taken out of its row before the map saw it. */
interface Taken {
  section: FFSection;
  /** The row as the map sees it. */
  row: FFRow;
  column: FFColumn;
  value: string;
  /** A note, or a value that didn't fit a column placed into this target. */
  as: { note: NoteTopic } | { unfit: TargetKind };
  /** Over CELL_MAX: `value` is its first CELL_MAX characters. */
  cut?: true;
}

/** The row without its notes and the cells that didn't fit; `taken` gets them, and `removed` every cell taken out. */
function cleanRow(section: FFSection, map: SectionMap, row: FFRow, taken: Taken[], removed: Set<string>): FFRow {
  const clean: FFRow = { ...row, cells: { ...row.cells } };
  for (const column of section.columns) {
    const cell = row.cells[column.id];
    if (!cell || isBlank(cell.value)) continue;
    const placement = map.placements[column.id];
    const long = typeof cell.value === "string" && cell.value.length > CELL_MAX;
    if (!("note" in placement) && cell.issue === undefined && fits(column, cell.value) && !long) continue;
    delete clean.cells[column.id];
    removed.add(cellKey(row.id, column.id));
    const value = long ? String(cell.value).slice(0, CELL_MAX) : String(cell.value);
    const cut = long ? { cut: true as const } : {};
    if ("note" in placement) taken.push({ section, row: clean, column, value, as: { note: placement.note }, ...cut });
    // A context column's unfit value is only dropped: it is never saved anyway.
    else if ("to" in placement) taken.push({ section, row: clean, column, value, as: { unfit: placement.to.split(".")[0] as TargetKind }, ...cut });
  }
  return clean;
}

/** A draft of the row: on it, or with a field from one of its cells (a grouped line sits on its group's first row). */
const ofRow = (d: TargetDraft, rowId: string) => d.rowId === rowId || d.fields.some((f) => f.from.some((c) => c.rowId === rowId));

/**
 * A list row is called what its first line is called ("Fidelity IRA"); a fixed
 * row by its section and label ("Living Expenses — Current"); a notes box by its
 * section. Task 18 prints these as written.
 */
function labelOfRow(section: FFSection, row: FFRow, drafts: readonly TargetDraft[]): string {
  if (section.layout === "notes") return section.label;
  if (section.layout === "fixedRows") return rowLabel(section, row);
  return drafts.find((d) => d.rowId === row.id)?.label ?? rowLabel(section, row);
}

/** The targets a section's columns are placed into. */
const writesOf = (map: SectionMap) => new Set(Object.values(map.placements).flatMap((p) => ("to" in p ? [p.to.split(".")[0]] : [])));

/** An account record's category in plain words, with its article. */
const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  cash: "a cash",
  taxable: "a taxable",
  retirement: "a retirement",
  annuity: "an annuity",
  education_savings: "a 529 / education savings",
  real_estate: "a real estate",
  notes_receivable: "a notes receivable",
};

/**
 * Why a row confirmed to another kind of account can't update it (D11 accepts
 * both kinds of account record): a business for an account row or the other way
 * round, or an account of another category than the row's section. Null when it can.
 */
function wrongKindLink(section: FFSection, writes: ReadonlySet<string>, row: FFRow, book: RecordBook): string | null {
  const link = row.link;
  if (!section.links || link?.kind !== "existing" || !link.confirmed) return null;
  const held = LINK_TARGETS[section.links]
    .map((target) => ({ target, record: findRecord(book, target, link.recordId) }))
    .find((h) => h.record !== undefined);
  if (!held?.record) return null;
  const { target: holder, record } = held;
  if (!writes.has(holder)) {
    return holder === "business_account"
      ? `Links to: "${record.label}" is a business on the plan, so this row can't update it — link it to another record, or pick New.`
      : `Links to: "${record.label}" isn't a business on the plan, so this row can't update it — link it to a business, or pick New.`;
  }
  const category: string | undefined = SECTION_ACCOUNT_CATEGORY[section.id as keyof typeof SECTION_ACCOUNT_CATEGORY];
  if (holder !== "account" || category === undefined || record.facts?.category === category) return null;
  const words = CATEGORY_WORDS[String(record.facts?.category)] ?? "another kind of";
  return `Links to: "${record.label}" is ${words} account on the plan, so this row can't update it — link it to another record, or pick New.`;
}

export function placeFactFinder(state: FactFinderState, book: RecordBook, now: Date): Placed {
  const maps = FACT_FINDER_SECTIONS.map((section) => {
    const map = sectionMapFor(section.id);
    if (!map) throw new Error(`No section map for "${section.id}"`);
    return { section, map };
  });

  const taken: Taken[] = [];
  const removed = new Set<string>();
  const sections: Record<string, FFRow[]> = { ...state.sections };
  for (const { section, map } of maps) {
    sections[section.id] = (state.sections[section.id] ?? []).map((row) => cleanRow(section, map, row, taken, removed));
  }
  const clean: FactFinderState = { ...state, sections };

  const notices: string[] = [];
  const meta = fixedRow(clean, "meta", "Household");
  const ctx: PlaceContext = {
    state: clean,
    book,
    refs: buildRefIndex(clean, book),
    asOf: meta ? text(meta, "dateCompleted") : null,
    year: now.getUTCFullYear(),
    removed: (rowId, columnId) => removed.has(cellKey(rowId, columnId)),
    notice: (message) => {
      notices.push(message);
    },
  };

  const drafts: TargetDraft[] = [];
  for (const { section, map } of maps) drafts.push(...map.place(sections[section.id].filter(rowHasValues), ctx));
  const ids = new Set<string>();
  for (const d of drafts) {
    if (ids.has(d.lineId)) throw new Error(`Two drafts share the line id "${d.lineId}" (a section map bug)`);
    ids.add(d.lineId);
  }

  // The runner's blocks replace a map's: each names the root cause. A wrong link first — it is the whole row's.
  const blocks = new Map<string, { reason: string; cell?: CellRef }>();
  for (const { section, map } of maps) {
    const writes = writesOf(map);
    for (const row of sections[section.id]) {
      const reason = wrongKindLink(section, writes, row, book);
      if (reason === null) continue;
      for (const d of drafts) if (d.rowId === row.id && !blocks.has(d.lineId)) blocks.set(d.lineId, { reason });
    }
  }

  const leftovers: LeftoverItem[] = [];
  for (const { section, row, column, value, as, cut } of taken) {
    const cell: CellRef = { sectionId: section.id, rowId: row.id, columnId: column.id };
    const name = labelOfRow(section, row, drafts);
    if ("note" in as || column.kind !== "choice") {
      if (cut) notices.push(`${column.label} (${name}): over 2,000 characters, so only the first 2,000 were read.`);
      leftovers.push({
        id: cellKey(row.id, column.id),
        cell,
        text: value,
        kind: "note" in as ? "note" : "unfit",
        topic: "note" in as ? as.note : UNFIT_TOPIC[section.page],
        columnLabel: column.label,
        rowLabel: name,
      });
      continue;
    }
    // The row's lines of the column's target, else all its lines: a choice that didn't fit is never dropped silently.
    const mine = drafts.filter((d) => ofRow(d, row.id));
    const hit = mine.some((d) => d.target === as.unfit) ? mine.filter((d) => d.target === as.unfit) : mine;
    if (hit.length === 0) notices.push(`${column.label} (${name}): "${value}" isn't one of the options — pick one, then review again.`);
    const reason = cut
      ? `${column.label}: over 2,000 characters, so it isn't one of the options — pick one.`
      : `${column.label}: "${value}" isn't one of the options — pick one.`;
    for (const d of hit) if (!blocks.has(d.lineId)) blocks.set(d.lineId, { reason, cell });
  }

  const holdings = state.unassignedHoldings.length;
  if (holdings > 0) {
    notices.push(
      holdings === 1
        ? "1 holding isn't assigned to an account and won't be saved."
        : `${holdings} holdings aren't assigned to an account and won't be saved.`,
    );
  }

  return {
    drafts: drafts.map((d) => {
      const blocked = blocks.get(d.lineId);
      return blocked ? { ...d, blocked } : d;
    }),
    leftovers,
    notices,
  };
}
