// src/lib/fact-finder/state.ts
import { REVIEW_THRESHOLD } from "@/lib/entity-extraction/confidence";
import { FACT_FINDER_SECTIONS, fixedLabelsOf, type FFSection } from "./schema";
import type { FactFinderState, FFCell, FFCellValue, FFRow } from "./types";

export { REVIEW_THRESHOLD };

export function fixedRowId(sectionId: string, label: string): string {
  return `${sectionId}:${label}`;
}

/** The section's fixed row with this label ("people", "Co-client"); undefined when the fact finder has none. */
export function fixedRow(state: FactFinderState, sectionId: string, label: string): FFRow | undefined {
  return (state.sections[sectionId] ?? []).find((r) => r.id === fixedRowId(sectionId, label));
}

/** "Co-client" for `ss:Co-client`; null when the id isn't one of the section's fixed rows. */
export function fixedLabelOfRow(sectionId: string, rowId: string): string | null {
  const prefix = `${sectionId}:`;
  return rowId.startsWith(prefix) ? rowId.slice(prefix.length) : null;
}

function emptyFixedRow(sectionId: string, label: string): FFRow {
  return { id: fixedRowId(sectionId, label), cells: {}, sourceFileIds: [] };
}

export function emptyFactFinderState(): FactFinderState {
  const sections: Record<string, FFRow[]> = {};
  for (const s of FACT_FINDER_SECTIONS) {
    sections[s.id] = fixedLabelsOf(s).map((label) => emptyFixedRow(s.id, label));
  }
  return { version: 0, sections, removed: [], unassignedHoldings: [], transcript: [], undo: {}, readings: {} };
}

/**
 * The stored slice, or an empty fact finder. Sections and fixed rows added to
 * the schema after the slice was written are filled in, so an older draft
 * never crashes the screen.
 */
export function readFactFinderState(payloadJson: unknown): FactFinderState {
  const stored = (payloadJson as { factFinder?: Partial<FactFinderState> } | null | undefined)?.factFinder;
  if (!stored) return emptyFactFinderState();
  const sections: Record<string, FFRow[]> = { ...(stored.sections ?? {}) };
  for (const s of FACT_FINDER_SECTIONS) {
    const rows = sections[s.id] ?? [];
    const missing = fixedLabelsOf(s)
      .filter((label) => !rows.some((r) => r.id === fixedRowId(s.id, label)))
      .map((label) => emptyFixedRow(s.id, label));
    sections[s.id] = missing.length > 0 ? [...rows, ...missing] : rows;
  }
  return {
    version: stored.version ?? 0,
    sections,
    removed: stored.removed ?? [],
    unassignedHoldings: stored.unassignedHoldings ?? [],
    transcript: stored.transcript ?? [],
    undo: stored.undo ?? {},
    readings: stored.readings ?? {},
    ...(stored.changeSet ? { changeSet: stored.changeSet } : {}),
  };
}

export function isBlank(value: FFCellValue | undefined): boolean {
  return value === null || value === undefined || value === "";
}

export function cellValue(row: FFRow, columnId: string): FFCellValue {
  return row.cells[columnId]?.value ?? null;
}

/** Non-blank values by column id. */
export function rowValues(row: FFRow): Record<string, FFCellValue> {
  const out: Record<string, FFCellValue> = {};
  for (const [columnId, cell] of Object.entries(row.cells)) {
    if (!isBlank(cell.value)) out[columnId] = cell.value;
  }
  return out;
}

export function rowHasValues(row: FFRow): boolean {
  return Object.values(row.cells).some((cell) => !isBlank(cell.value));
}

/** A short human label: "Joint Checking", "Social Security — Client", "Cash Accounts row". */
export function rowLabel(section: FFSection, row: FFRow): string {
  const fixed = fixedLabelOfRow(section.id, row.id);
  if (fixed !== null && fixedLabelsOf(section).includes(fixed)) return `${section.label} — ${fixed}`;
  for (const column of section.columns) {
    const value = row.cells[column.id]?.value;
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return `${section.label} row`;
}

export function locateRow(state: FactFinderState, rowId: string): { sectionId: string; index: number } | null {
  for (const [sectionId, rows] of Object.entries(state.sections)) {
    const index = rows.findIndex((r) => r.id === rowId);
    if (index >= 0) return { sectionId, index };
  }
  return null;
}

/** A document value the advisor should look at. Advisor and chat values never need a check. */
export function cellNeedsCheck(cell: FFCell | undefined): boolean {
  if (!cell || cell.pinned || isBlank(cell.value)) return false;
  return cell.issue !== undefined || (cell.confidence ?? 1) < REVIEW_THRESHOLD;
}

export function countCellsToCheck(state: FactFinderState): number {
  let n = 0;
  for (const rows of Object.values(state.sections)) {
    for (const row of rows) for (const cell of Object.values(row.cells)) if (cellNeedsCheck(cell)) n += 1;
  }
  return n;
}

export function linkNeedsClick(row: FFRow): boolean {
  return row.link?.kind === "existing" && !row.link.confirmed;
}

export function countLinksNeedingClick(state: FactFinderState): number {
  let n = 0;
  for (const rows of Object.values(state.sections)) for (const row of rows) if (linkNeedsClick(row)) n += 1;
  return n;
}

/** Identity of a holding: its ticker, else its name. */
export function holdingKey(h: { ticker?: string | null; name?: string | null }): string | null {
  const ticker = h.ticker?.trim().toUpperCase();
  if (ticker) return `t:${ticker}`;
  const name = h.name?.trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `n:${name}` : null;
}

/**
 * JSON with sorted keys and undefined keys dropped. Postgres jsonb reorders
 * object keys, so plain JSON.stringify can't compare a stored row to one built
 * in memory.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
