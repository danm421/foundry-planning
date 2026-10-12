// src/lib/fact-finder/merge.ts
import { FACT_FINDER_SECTIONS, findSection, fixedLabelsOf, type FFSection } from "./schema";
import { last4Of, normText, sameIdentity } from "./identity";
import { fixedRowId, holdingKey, isBlank, rowLabel, rowValues, sameJson } from "./state";
import type {
  FactFinderState,
  FFCell,
  FFCellValue,
  FFHolding,
  FFMergeDecision,
  FFReadCell,
  FFReadHolding,
  FFReading,
  FFRemoved,
  FFRow,
  FFUnassignedReading,
} from "./types";

export interface MergeContext {
  now: string;
  newId: () => string;
}

export interface MergeResult {
  state: FactFinderState;
  decisions: FFMergeDecision[];
}

/**
 * Folds readings into the fact finder (spec § 2 mergeReading). Pure, and
 * idempotent: merging the same readings twice returns the same state object.
 */
export function mergeReadings(
  state: FactFinderState,
  readings: readonly FFReading[],
  ctx: MergeContext,
  unassigned: readonly FFUnassignedReading[] = [],
): MergeResult {
  let next = state;
  const decisions: FFMergeDecision[] = [];
  for (const reading of readings) {
    const section = findSection(reading.sectionId);
    if (!section) continue;
    const result = mergeOne(next, section, reading, ctx);
    next = result.state;
    if (result.decision) decisions.push(result.decision);
  }
  for (const holding of unassigned) {
    const result = placeUnassigned(next, holding, ctx);
    next = result.state;
    if (result.decision) decisions.push(result.decision);
  }
  return { state: next, decisions };
}

interface OneResult {
  state: FactFinderState;
  decision?: FFMergeDecision;
}

function readingValues(reading: FFReading): Record<string, FFCellValue> {
  const out: Record<string, FFCellValue> = {};
  for (const [columnId, c] of Object.entries(reading.cells)) if (!isBlank(c.value)) out[columnId] = c.value;
  return out;
}

const matches = (sectionId: string, values: Record<string, FFCellValue>, row: FFRow) =>
  sameIdentity(sectionId, values, row.identity ?? {}) || sameIdentity(sectionId, values, rowValues(row));

function setRow(state: FactFinderState, sectionId: string, row: FFRow): FactFinderState {
  const rows = state.sections[sectionId] ?? [];
  const index = rows.findIndex((r) => r.id === row.id);
  const nextRows = index >= 0 ? rows.map((r, i) => (i === index ? row : r)) : [...rows, row];
  return { ...state, sections: { ...state.sections, [sectionId]: nextRows } };
}

function mergeOne(state: FactFinderState, section: FFSection, reading: FFReading, ctx: MergeContext): OneResult {
  const fixed = fixedLabelsOf(section);
  if (fixed.length > 0) {
    const label = reading.fixedRow ?? fixed[0];
    if (!fixed.includes(label)) return { state };
    const id = fixedRowId(section.id, label);
    const current = (state.sections[section.id] ?? []).find((r) => r.id === id) ?? { id, cells: {}, sourceFileIds: [] };
    return updateRow(state, section, current, reading, ctx);
  }

  const values = readingValues(reading);
  const live = (state.sections[section.id] ?? []).find((r) => matches(section.id, values, r));
  if (live) return updateRow(state, section, live, reading, ctx);

  const trayIndex = state.removed.findIndex((e) => e.sectionId === section.id && matches(section.id, values, e.row));
  if (trayIndex >= 0) {
    const entry = state.removed[trayIndex];
    const kept = entry.mergedInto ? (state.sections[section.id] ?? []).find((r) => r.id === entry.mergedInto) : undefined;
    if (kept) return updateRow(state, section, kept, reading, ctx);
    if (entry.row.sourceFileIds.includes(reading.fileId)) return { state };
    const absorbed: FFRemoved = {
      ...entry,
      absorbed: (entry.absorbed ?? 0) + 1,
      row: { ...entry.row, sourceFileIds: [...entry.row.sourceFileIds, reading.fileId] },
    };
    return {
      state: { ...state, removed: state.removed.map((e, i) => (i === trayIndex ? absorbed : e)) },
      decision: { kind: "keptRemoved", sectionId: section.id, rowId: entry.row.id, label: rowLabel(section, entry.row), fileId: reading.fileId },
    };
  }

  const row = newRow(reading, values, ctx);
  const label = rowLabel(section, row);
  if (reading.exclude) {
    const entry: FFRemoved = { sectionId: section.id, row, reason: reading.exclude.reason, by: "document", at: ctx.now };
    return {
      state: { ...state, removed: [...state.removed, entry] },
      decision: { kind: "excluded", sectionId: section.id, rowId: row.id, label, fileId: reading.fileId, reason: reading.exclude.reason },
    };
  }
  return {
    state: setRow(state, section.id, row),
    decision: { kind: "added", sectionId: section.id, rowId: row.id, label, fileId: reading.fileId },
  };
}

function toCell(c: FFReadCell): FFCell {
  return { value: c.value, confidence: c.confidence, source: c.source, by: "document", ...(c.issue ? { issue: c.issue } : {}) };
}

function toHolding(h: FFReadHolding, fileId: string, ctx: MergeContext): FFHolding {
  return {
    id: ctx.newId(),
    ticker: h.ticker ?? null,
    name: h.name ?? null,
    shares: h.shares ?? null,
    price: h.price ?? null,
    marketValue: h.marketValue ?? null,
    costBasis: h.costBasis ?? null,
    by: "document",
    source: { fileId },
  };
}

function newRow(reading: FFReading, values: Record<string, FFCellValue>, ctx: MergeContext): FFRow {
  const cells: Record<string, FFCell> = {};
  for (const [columnId, c] of Object.entries(reading.cells)) if (!isBlank(c.value)) cells[columnId] = toCell(c);
  const holdings = reading.holdings?.length ? reading.holdings.map((h) => toHolding(h, reading.fileId, ctx)) : undefined;
  return {
    id: ctx.newId(),
    identity: values,
    cells,
    ...(holdings ? { holdings, ...(reading.statementDate ? { holdingsAsOf: reading.statementDate } : {}) } : {}),
    sourceFileIds: [reading.fileId],
    ...(reading.statementDate ? { statementDate: reading.statementDate } : {}),
  };
}

const isNewer = (a: string | undefined, b: string | undefined) => !!a && (!b || a > b);
const isOlder = (a: string | undefined, b: string | undefined) => !!a && !!b && a < b;

function updateRow(state: FactFinderState, section: FFSection, row: FFRow, reading: FFReading, ctx: MergeContext): OneResult {
  const columns: string[] = [];
  const cells = { ...row.cells };
  const newer = isNewer(reading.statementDate, row.statementDate);
  const older = isOlder(reading.statementDate, row.statementDate);
  for (const [columnId, incoming] of Object.entries(reading.cells)) {
    if (isBlank(incoming.value)) continue;
    const existing = cells[columnId];
    if (existing?.pinned) continue;
    const existingBlank = !existing || isBlank(existing.value);
    if (!existingBlank && sameJson(existing.value, incoming.value)) continue;
    const take = existingBlank || newer || (!older && incoming.confidence > (existing.confidence ?? 1));
    if (!take) continue;
    cells[columnId] = toCell(incoming);
    columns.push(columnId);
  }

  let holdings = row.holdings;
  let holdingsAsOf = row.holdingsAsOf;
  let holdingsChanged = false;
  if (reading.holdings?.length) {
    const dropped = new Set(row.droppedHoldingKeys ?? []);
    const keep = (h: { ticker?: string | null; name?: string | null }) => {
      const key = holdingKey(h);
      return !key || !dropped.has(key);
    };
    if (!row.holdings?.length) {
      // Only when something survives the advisor's removals — else re-reading would churn an empty list.
      const fresh = reading.holdings.filter(keep);
      if (fresh.length > 0) {
        holdings = fresh.map((h) => toHolding(h, reading.fileId, ctx));
        holdingsAsOf = reading.statementDate;
        holdingsChanged = true;
      }
    } else if (isNewer(reading.statementDate, row.holdingsAsOf)) {
      const pinned = row.holdings.filter((h) => h.pinned);
      const pinnedKeys = new Set(pinned.map((h) => holdingKey(h)).filter((k): k is string => k !== null));
      holdings = [
        ...reading.holdings
          .filter((h) => keep(h) && !pinnedKeys.has(holdingKey(h) ?? ""))
          .map((h) => toHolding(h, reading.fileId, ctx)),
        ...pinned,
      ];
      holdingsAsOf = reading.statementDate;
      holdingsChanged = true;
    }
  }

  const newFile = !row.sourceFileIds.includes(reading.fileId);
  const statementDate = newer ? reading.statementDate : row.statementDate;
  const identity = row.identity ?? (section.layout === "fixedRows" || section.layout === "notes" ? undefined : readingValues(reading));
  if (columns.length === 0 && !holdingsChanged && !newFile && statementDate === row.statementDate && identity === row.identity) {
    return { state };
  }
  const updated: FFRow = {
    ...row,
    cells,
    ...(identity ? { identity } : {}),
    ...(holdings ? { holdings } : {}),
    ...(holdingsAsOf ? { holdingsAsOf } : {}),
    sourceFileIds: newFile ? [...row.sourceFileIds, reading.fileId] : row.sourceFileIds,
    ...(statementDate ? { statementDate } : {}),
  };
  return {
    state: setRow(state, section.id, updated),
    decision:
      columns.length > 0
        ? { kind: "updated", sectionId: section.id, rowId: row.id, label: rowLabel(section, updated), fileId: reading.fileId, columns }
        : undefined,
  };
}

const HOLDING_SECTIONS = FACT_FINDER_SECTIONS.filter((s) => s.holdings);

/** Places one "Account (name or last 4)" holding on the matching account row, else keeps it unassigned. */
function placeUnassigned(state: FactFinderState, u: FFUnassignedReading, ctx: MergeContext): OneResult {
  const digits = last4Of(u.accountHint);
  const hint = normText(u.accountHint);
  const found: Array<{ sectionId: string; row: FFRow }> = [];
  for (const section of HOLDING_SECTIONS) {
    for (const row of state.sections[section.id] ?? []) {
      const values = rowValues(row);
      const name = normText(values.accountName);
      const byDigits = digits !== "" && last4Of(values.last4) === digits;
      const byName = digits === "" && hint !== "" && name !== "" && (name === hint || name.includes(hint));
      if (byDigits || byName) found.push({ sectionId: section.id, row });
    }
  }
  const key = holdingKey(u.holding);
  if (found.length === 1) {
    const { sectionId, row } = found[0];
    const already = (row.holdings ?? []).some((h) => key !== null && holdingKey(h) === key);
    if (already || (key !== null && (row.droppedHoldingKeys ?? []).includes(key))) return { state };
    const holding = { ...toHolding(u.holding, u.fileId, ctx), source: u.source };
    return { state: setRow(state, sectionId, { ...row, holdings: [...(row.holdings ?? []), holding] }) };
  }
  if (state.unassignedHoldings.some((h) => normText(h.accountHint) === hint && holdingKey(h) === key)) return { state };
  const holding = { ...toHolding(u.holding, u.fileId, ctx), source: u.source, accountHint: u.accountHint };
  return {
    state: { ...state, unassignedHoldings: [...state.unassignedHoldings, holding] },
    decision: { kind: "holdingUnassigned", fileId: u.fileId, accountHint: u.accountHint },
  };
}
