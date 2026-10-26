// src/lib/fact-finder/ops.ts
import { z } from "zod";
import { FACT_FINDER_SECTIONS, findColumn, findSection, isListLike, type FFColumn, type FFSection } from "./schema";
import { normalizeCell, parseMoney, parseNumber } from "./normalize";
import { holdingKey, isBlank, locateRow, rowLabel, sameJson } from "./state";
import {
  HOLDING_FIELDS,
  type FactFinderState,
  type FFCell,
  type FFHolding,
  type FFHoldingField,
  type FFLink,
  type FFRemoved,
  type FFRow,
  type FFRowLocation,
  type FFSnapshot,
  type FFUnassignedHolding,
} from "./types";

export class FactFinderOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactFinderOpError";
  }
}

export interface OpContext {
  by: "advisor" | "chat";
  /** ISO timestamp stamped on tray entries. */
  now: string;
  newId: () => string;
}

const id = z.string().min(1).max(100);
const target = z.object({ sectionId: id, rowId: id });

const clientOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setCell"), sectionId: id, rowId: id, columnId: id, value: z.unknown() }),
  z.object({ op: z.literal("clearCell"), sectionId: id, rowId: id, columnId: id }),
  z.object({
    op: z.literal("addRow"),
    sectionId: id,
    rowId: id.optional(),
    cells: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ op: z.literal("removeRow"), sectionId: id, rowId: id, reason: z.string().max(500).optional() }),
  z.object({ op: z.literal("restoreRow"), rowId: id }),
  z.object({ op: z.literal("mergeRows"), sectionId: id, keepRowId: id, dropRowId: id }),
  z.object({
    op: z.literal("setLink"),
    sectionId: id,
    rowId: id,
    link: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("existing"), recordId: id }),
      z.object({ kind: z.literal("new") }),
    ]),
  }),
  z.object({
    op: z.literal("setHolding"),
    sectionId: id,
    rowId: id,
    holdingId: id,
    field: z.enum(HOLDING_FIELDS),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("addHolding"),
    sectionId: id,
    rowId: id,
    holdingId: id,
    holding: z.partialRecord(z.enum(HOLDING_FIELDS), z.union([z.string(), z.number(), z.null()])),
  }),
  z.object({ op: z.literal("removeHolding"), sectionId: id, rowId: id, holdingId: id }),
  z.object({
    op: z.literal("assignHolding"),
    holdingId: id,
    from: z.union([z.literal("unassigned"), target]),
    to: target,
  }),
]);

export type ClientOp = z.infer<typeof clientOp>;
/** `restoreSnapshots` is server-only (undo); `parseOps` never accepts it. */
export type FFOp = ClientOp | { op: "restoreSnapshots"; snapshots: FFSnapshot[] };

/** The most ops one save (PATCH) carries; the screen sends a longer queue in turns. */
export const MAX_OPS_PER_SAVE = 200;

const clientOps = z.array(clientOp).min(1).max(MAX_OPS_PER_SAVE);

export function parseOps(input: unknown): FFOp[] {
  const parsed = clientOps.safeParse(input);
  if (!parsed.success) {
    throw new FactFinderOpError(`That edit isn't valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}.`);
  }
  return parsed.data;
}

/** How many ops of each kind a batch holds (audit metadata) — staging ops or worksheet ops. */
export function countOps(ops: readonly { op: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const op of ops) counts[op.op] = (counts[op.op] ?? 0) + 1;
  return counts;
}

/** Applies every op or none (throws). Untouched rows keep their object identity. */
export function applyOps(state: FactFinderState, ops: readonly FFOp[], ctx: OpContext): FactFinderState {
  return ops.reduce((s, op) => applyOne(s, op, ctx), state);
}

const KIND_HINT: Record<string, string> = {
  money: "a dollar amount",
  number: "a number",
  percent: "a percent, like 6.5",
  integer: "a whole number",
  year: "a 4-digit year",
  date: "a date",
  monthYear: "a month and year",
  check: "yes or no",
};

function invalidValue(column: FFColumn, text: string): FactFinderOpError {
  if (column.kind === "choice") {
    return new FactFinderOpError(
      `"${text}" isn't one of the options for ${column.label}: ${(column.options ?? []).join(", ")}.`,
    );
  }
  return new FactFinderOpError(`"${text}" isn't a valid ${column.label} (${KIND_HINT[column.kind] ?? "text"}).`);
}

function sectionOrThrow(sectionId: string): FFSection {
  const section = findSection(sectionId);
  if (!section) throw new FactFinderOpError(`There's no fact finder section "${sectionId}".`);
  return section;
}

function columnOrThrow(section: FFSection, columnId: string): FFColumn {
  const column = findColumn(section.id, columnId);
  if (!column) throw new FactFinderOpError(`${section.label} has no column "${columnId}".`);
  return column;
}

function rowsOf(state: FactFinderState, sectionId: string): FFRow[] {
  return state.sections[sectionId] ?? [];
}

function rowIndexOrThrow(state: FactFinderState, section: FFSection, rowId: string): number {
  const index = rowsOf(state, section.id).findIndex((r) => r.id === rowId);
  if (index < 0) throw new FactFinderOpError(`That row isn't in ${section.label} any more.`);
  return index;
}

function withRows(state: FactFinderState, sectionId: string, rows: FFRow[]): FactFinderState {
  return { ...state, sections: { ...state.sections, [sectionId]: rows } };
}

function replaceRow(state: FactFinderState, sectionId: string, index: number, row: FFRow): FactFinderState {
  return withRows(state, sectionId, rowsOf(state, sectionId).map((r, i) => (i === index ? row : r)));
}

function allRowIds(state: FactFinderState): Set<string> {
  const ids = new Set<string>();
  for (const rows of Object.values(state.sections)) for (const r of rows) ids.add(r.id);
  for (const e of state.removed) ids.add(e.row.id);
  return ids;
}

function normalizedCell(column: FFColumn, raw: unknown, by: OpContext["by"]): FFCell {
  const result = normalizeCell(column, raw);
  if (!result.ok) throw invalidValue(column, result.text);
  return { value: result.value, by, pinned: true };
}

function union(a: readonly string[] = [], b: readonly string[] = []): string[] {
  return [...new Set([...a, ...b])];
}

function laterDate(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function normalizeHoldingValue(field: FFHoldingField, raw: unknown): string | number | null {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return null;
  if (field === "ticker" || field === "name") {
    const text = String(raw).trim();
    return field === "ticker" ? text.toUpperCase() : text;
  }
  const label = field === "marketValue" ? "market value" : field === "costBasis" ? "cost basis" : field;
  const n =
    typeof raw === "number" ? raw : field === "shares" ? parseNumber(String(raw)) : parseMoney(String(raw));
  if (n === null || !Number.isFinite(n) || n < 0) {
    throw new FactFinderOpError(`"${String(raw)}" isn't a valid ${label}.`);
  }
  return n;
}

function withoutHint(h: FFUnassignedHolding): FFHolding {
  return {
    id: h.id,
    ticker: h.ticker,
    name: h.name,
    shares: h.shares,
    price: h.price,
    marketValue: h.marketValue,
    costBasis: h.costBasis,
    by: h.by,
    ...(h.pinned ? { pinned: h.pinned } : {}),
    ...(h.source ? { source: h.source } : {}),
  };
}

/**
 * An edited row's automatic link was scored on its old values: drop it and its
 * suggestions so the next scoring starts fresh. A link the advisor or the chat
 * chose stays.
 */
function withoutAutoLink(row: FFRow): FFRow {
  if (row.link?.by !== "auto") return row;
  const next = { ...row };
  delete next.link;
  delete next.linkCandidates;
  return next;
}

/** Confirming record X on one row releases every other row of that record kind confirmed to X. */
function releaseOtherClaims(state: FactFinderState, section: FFSection, keepRowId: string, recordId: string): FactFinderState {
  let next = state;
  for (const s of FACT_FINDER_SECTIONS) {
    if (s.links !== section.links) continue;
    const rows = rowsOf(next, s.id);
    const updated = rows.map((r) =>
      r.id !== keepRowId && r.link?.kind === "existing" && r.link.recordId === recordId && r.link.confirmed
        ? { ...r, link: { ...r.link, confirmed: false } }
        : r,
    );
    if (updated.some((r, i) => r !== rows[i])) next = withRows(next, s.id, updated);
  }
  return next;
}

/**
 * Rows coming back (restore, undo) yield: a returning row confirmed to a record
 * that another live row of the same record kind already confirms comes back as
 * a suggestion. The live row keeps its claim.
 */
function yieldTakenClaims(state: FactFinderState, returningIds: ReadonlySet<string>): FactFinderState {
  const claimedElsewhere = (kind: FFSection["links"], recordId: string) =>
    FACT_FINDER_SECTIONS.some(
      (s) =>
        s.links === kind &&
        rowsOf(state, s.id).some(
          (r) => !returningIds.has(r.id) && r.link?.kind === "existing" && r.link.recordId === recordId && r.link.confirmed,
        ),
    );
  let next = state;
  for (const rowId of returningIds) {
    const at = locateRow(next, rowId);
    if (!at) continue;
    const row = rowsOf(next, at.sectionId)[at.index];
    const kind = findSection(at.sectionId)?.links;
    if (kind && row.link?.kind === "existing" && row.link.confirmed && claimedElsewhere(kind, row.link.recordId)) {
      next = replaceRow(next, at.sectionId, at.index, { ...row, link: { ...row.link, confirmed: false } });
    }
  }
  return next;
}

function applyOne(state: FactFinderState, op: FFOp, ctx: OpContext): FactFinderState {
  switch (op.op) {
    case "setCell":
    case "clearCell": {
      const section = sectionOrThrow(op.sectionId);
      const column = columnOrThrow(section, op.columnId);
      const index = rowIndexOrThrow(state, section, op.rowId);
      const row = rowsOf(state, section.id)[index];
      const cell: FFCell =
        op.op === "clearCell" ? { value: null, by: ctx.by, pinned: true } : normalizedCell(column, op.value, ctx.by);
      return replaceRow(state, section.id, index, { ...withoutAutoLink(row), cells: { ...row.cells, [column.id]: cell } });
    }

    case "addRow": {
      const section = sectionOrThrow(op.sectionId);
      if (!isListLike(section)) {
        throw new FactFinderOpError(`${section.label} has fixed rows — edit them instead of adding one.`);
      }
      const rowId = op.rowId ?? ctx.newId();
      if (allRowIds(state).has(rowId)) throw new FactFinderOpError(`Row id "${rowId}" is already in use.`);
      const cells: Record<string, FFCell> = {};
      for (const [columnId, raw] of Object.entries(op.cells ?? {})) {
        const cell = normalizedCell(columnOrThrow(section, columnId), raw, ctx.by);
        if (!isBlank(cell.value)) cells[columnId] = cell;
      }
      return withRows(state, section.id, [...rowsOf(state, section.id), { id: rowId, cells, sourceFileIds: [] }]);
    }

    case "removeRow": {
      const section = sectionOrThrow(op.sectionId);
      if (!isListLike(section)) {
        throw new FactFinderOpError(`${section.label} rows can't be removed — clear their values instead.`);
      }
      const index = rowIndexOrThrow(state, section, op.rowId);
      const rows = rowsOf(state, section.id);
      const entry: FFRemoved = {
        sectionId: section.id,
        row: rows[index],
        reason: op.reason?.trim() || "Removed",
        by: ctx.by,
        at: ctx.now,
      };
      const next = withRows(state, section.id, rows.filter((_, i) => i !== index));
      return { ...next, removed: [...next.removed, entry] };
    }

    case "restoreRow": {
      const at = state.removed.findIndex((e) => e.row.id === op.rowId);
      if (at < 0) throw new FactFinderOpError("That row isn't in the Removed tray.");
      const entry = state.removed[at];
      sectionOrThrow(entry.sectionId);
      if (locateRow(state, op.rowId)) {
        throw new FactFinderOpError("That row is already in the fact finder — it can't be restored again.");
      }
      const next = { ...state, removed: state.removed.filter((_, i) => i !== at) };
      const restored = withRows(next, entry.sectionId, [...rowsOf(next, entry.sectionId), entry.row]);
      return yieldTakenClaims(restored, new Set([op.rowId]));
    }

    case "mergeRows": {
      const section = sectionOrThrow(op.sectionId);
      if (!isListLike(section)) {
        throw new FactFinderOpError(`${section.label} rows can't be merged — edit or clear their values instead.`);
      }
      if (op.keepRowId === op.dropRowId) throw new FactFinderOpError("Pick two different rows to merge.");
      const keepIndex = rowIndexOrThrow(state, section, op.keepRowId);
      const dropIndex = rowIndexOrThrow(state, section, op.dropRowId);
      const rows = rowsOf(state, section.id);
      const keep = rows[keepIndex];
      const drop = rows[dropIndex];
      const cells = { ...keep.cells };
      for (const [columnId, cell] of Object.entries(drop.cells)) {
        const mine = cells[columnId];
        if (isBlank(cell.value) || (mine && (mine.pinned || !isBlank(mine.value)))) continue;
        cells[columnId] = cell;
      }
      const keepHasHoldings = (keep.holdings?.length ?? 0) > 0;
      const dropped = union(keep.droppedHoldingKeys, drop.droppedHoldingKeys);
      const merged: FFRow = {
        ...keep,
        cells,
        sourceFileIds: union(keep.sourceFileIds, drop.sourceFileIds),
        statementDate: laterDate(keep.statementDate, drop.statementDate),
        holdings: keepHasHoldings ? keep.holdings : drop.holdings,
        holdingsAsOf: keepHasHoldings ? keep.holdingsAsOf : drop.holdingsAsOf,
        ...(dropped.length > 0 ? { droppedHoldingKeys: dropped } : {}),
        link: keep.link ?? drop.link,
        // Suggestions travel with the link they belong to; with no link on either row, keep's win.
        linkCandidates: keep.link
          ? keep.linkCandidates
          : drop.link
            ? drop.linkCandidates
            : (keep.linkCandidates ?? drop.linkCandidates),
      };
      const entry: FFRemoved = {
        sectionId: section.id,
        row: drop,
        reason: `Merged into ${rowLabel(section, keep)}`,
        by: ctx.by,
        at: ctx.now,
        mergedInto: keep.id,
      };
      const nextRows = rows.map((r, i) => (i === keepIndex ? merged : r)).filter((_, i) => i !== dropIndex);
      const next = withRows(state, section.id, nextRows);
      return { ...next, removed: [...next.removed, entry] };
    }

    case "setLink": {
      const section = sectionOrThrow(op.sectionId);
      if (!section.links) throw new FactFinderOpError(`${section.label} rows don't link to records.`);
      const index = rowIndexOrThrow(state, section, op.rowId);
      const row = rowsOf(state, section.id)[index];
      let link: FFLink;
      if (op.link.kind === "new") {
        link = { kind: "new", by: ctx.by };
      } else {
        const recordId = op.link.recordId;
        const score = row.linkCandidates?.find((c) => c.recordId === recordId)?.score ?? null;
        link = { kind: "existing", recordId, score, confirmed: true, by: ctx.by };
      }
      const next = replaceRow(state, section.id, index, { ...row, link });
      return link.kind === "existing" ? releaseOtherClaims(next, section, row.id, link.recordId) : next;
    }

    case "addHolding": {
      const section = sectionOrThrow(op.sectionId);
      if (!section.holdings) throw new FactFinderOpError(`${section.label} rows don't carry holdings.`);
      const index = rowIndexOrThrow(state, section, op.rowId);
      const row = rowsOf(state, section.id)[index];
      const holdings = row.holdings ?? [];
      if (holdings.some((h) => h.id === op.holdingId)) throw new FactFinderOpError("That account already has a holding with that id.");
      const holding: FFHolding = { id: op.holdingId, ticker: null, name: null, shares: null, price: null, marketValue: null, costBasis: null, by: ctx.by, pinned: true };
      for (const field of HOLDING_FIELDS) {
        if (op.holding[field] !== undefined) Object.assign(holding, { [field]: normalizeHoldingValue(field, op.holding[field]) });
      }
      return replaceRow(state, section.id, index, { ...row, holdings: [...holdings, holding] });
    }

    case "setHolding":
    case "removeHolding": {
      const section = sectionOrThrow(op.sectionId);
      if (!section.holdings) throw new FactFinderOpError(`${section.label} rows don't carry holdings.`);
      const index = rowIndexOrThrow(state, section, op.rowId);
      const row = rowsOf(state, section.id)[index];
      const holdings = row.holdings ?? [];
      const at = holdings.findIndex((h) => h.id === op.holdingId);
      if (at < 0) throw new FactFinderOpError("That holding isn't on this account.");
      if (op.op === "removeHolding") {
        const key = holdingKey(holdings[at]);
        return replaceRow(state, section.id, index, {
          ...row,
          holdings: holdings.filter((_, i) => i !== at),
          ...(key ? { droppedHoldingKeys: union(row.droppedHoldingKeys, [key]) } : {}),
        });
      }
      const holding: FFHolding = {
        ...holdings[at],
        [op.field]: normalizeHoldingValue(op.field, op.value),
        by: ctx.by,
        pinned: true,
      };
      return replaceRow(state, section.id, index, { ...row, holdings: holdings.map((h, i) => (i === at ? holding : h)) });
    }

    case "assignHolding": {
      const toSection = sectionOrThrow(op.to.sectionId);
      if (!toSection.holdings) throw new FactFinderOpError(`${toSection.label} rows don't carry holdings.`);
      let next = state;
      let holding: FFHolding;
      if (op.from === "unassigned") {
        const at = state.unassignedHoldings.findIndex((h) => h.id === op.holdingId);
        if (at < 0) throw new FactFinderOpError("That holding isn't waiting for an account any more.");
        holding = withoutHint(state.unassignedHoldings[at]);
        next = { ...state, unassignedHoldings: state.unassignedHoldings.filter((_, i) => i !== at) };
      } else {
        const fromSection = sectionOrThrow(op.from.sectionId);
        const fromIndex = rowIndexOrThrow(next, fromSection, op.from.rowId);
        const fromRow = rowsOf(next, fromSection.id)[fromIndex];
        const at = (fromRow.holdings ?? []).findIndex((h) => h.id === op.holdingId);
        if (at < 0) throw new FactFinderOpError("That holding isn't on this account.");
        holding = fromRow.holdings![at];
        // Like removeHolding: a later reading of the source account must not put it back there.
        const key = holdingKey(holding);
        next = replaceRow(next, fromSection.id, fromIndex, {
          ...fromRow,
          holdings: fromRow.holdings!.filter((_, i) => i !== at),
          ...(key ? { droppedHoldingKeys: union(fromRow.droppedHoldingKeys, [key]) } : {}),
        });
      }
      const toIndex = rowIndexOrThrow(next, toSection, op.to.rowId);
      const toRow = rowsOf(next, toSection.id)[toIndex];
      return replaceRow(next, toSection.id, toIndex, {
        ...toRow,
        holdings: [...(toRow.holdings ?? []), { ...holding, by: ctx.by, pinned: true }],
      });
    }

    case "restoreSnapshots": {
      let next = state;
      for (const snap of op.snapshots) {
        if (snap.kind === "unassigned") {
          if (!sameJson(next.unassignedHoldings, snap.after)) {
            throw new FactFinderOpError("Can't undo — the unassigned holdings have changed since that reply.");
          }
          next = { ...next, unassignedHoldings: snap.before };
          continue;
        }
        if (snap.kind === "worksheet") {
          // Only the tables: a document composed since (an upload) doesn't block the Undo, and stays composed.
          if (!sameJson(next.worksheet.tables, snap.after.tables)) {
            throw new FactFinderOpError("Can't undo — the worksheet has changed since that reply.");
          }
          next = { ...next, worksheet: { ...snap.before, composedFileIds: next.worksheet.composedFileIds } };
          continue;
        }
        if (!sameLocation(locationOf(next, snap.rowId), snap.after)) {
          throw new FactFinderOpError(`Can't undo — ${describeLocation(snap)} has changed since that reply.`);
        }
        next = putLocation(removeLocation(next, snap.rowId), snap.before);
      }
      // After every row is back, so rows restored together never yield to each other.
      return yieldTakenClaims(next, new Set(op.snapshots.flatMap((s) => (s.kind === "row" ? [s.rowId] : []))));
    }
  }
}

// ---- undo snapshots -----------------------------------------------------------

export function locationOf(state: FactFinderState, rowId: string): FFRowLocation {
  for (const [sectionId, rows] of Object.entries(state.sections)) {
    const index = rows.findIndex((r) => r.id === rowId);
    if (index >= 0) return { where: "section", sectionId, index, row: rows[index] };
  }
  const entry = state.removed.find((e) => e.row.id === rowId);
  return entry ? { where: "removed", entry } : null;
}

function sameLocation(a: FFRowLocation, b: FFRowLocation): boolean {
  if (a === null || b === null) return a === b;
  if (a.where === "section" && b.where === "section") return a.sectionId === b.sectionId && sameJson(a.row, b.row);
  if (a.where === "removed" && b.where === "removed") return sameJson(a.entry, b.entry);
  return false;
}

function removeLocation(state: FactFinderState, rowId: string): FactFinderState {
  const loc = locationOf(state, rowId);
  if (loc === null) return state;
  if (loc.where === "removed") return { ...state, removed: state.removed.filter((e) => e.row.id !== rowId) };
  return withRows(state, loc.sectionId, rowsOf(state, loc.sectionId).filter((r) => r.id !== rowId));
}

function putLocation(state: FactFinderState, loc: FFRowLocation): FactFinderState {
  if (loc === null) return state;
  if (loc.where === "removed") return { ...state, removed: [...state.removed, loc.entry] };
  const rows = [...rowsOf(state, loc.sectionId)];
  rows.splice(Math.min(loc.index, rows.length), 0, loc.row);
  return withRows(state, loc.sectionId, rows);
}

function describeLocation(snap: Extract<FFSnapshot, { kind: "row" }>): string {
  const loc = snap.after ?? snap.before;
  if (loc === null) return "a row";
  const section = findSection(loc.where === "section" ? loc.sectionId : loc.entry.sectionId);
  const row = loc.where === "section" ? loc.row : loc.entry.row;
  return section ? `"${rowLabel(section, row)}"` : "a row";
}

function allIds(state: FactFinderState): string[] {
  return [...Object.values(state.sections).flatMap((rows) => rows.map((r) => r.id)), ...state.removed.map((e) => e.row.id)];
}

/**
 * One snapshot per row whose object or place differs between `before` and
 * `after`. Relies on `applyOps` keeping untouched rows by reference.
 */
export function diffSnapshots(before: FactFinderState, after: FactFinderState): FFSnapshot[] {
  const out: FFSnapshot[] = [];
  for (const rowId of new Set([...allIds(before), ...allIds(after)])) {
    const b = locationOf(before, rowId);
    const a = locationOf(after, rowId);
    const unchanged =
      b !== null &&
      a !== null &&
      ((b.where === "section" && a.where === "section" && b.sectionId === a.sectionId && b.row === a.row) ||
        (b.where === "removed" && a.where === "removed" && b.entry === a.entry));
    if (!unchanged) out.push({ kind: "row", rowId, before: b, after: a });
  }
  if (before.unassignedHoldings !== after.unassignedHoldings) {
    out.push({ kind: "unassigned", before: before.unassignedHoldings, after: after.unassignedHoldings });
  }
  return out;
}
