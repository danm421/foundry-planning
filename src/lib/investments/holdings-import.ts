import type { ExtractedHolding } from "@/lib/extraction/types";

/**
 * Spreadsheet import for one account's holdings: the columns an advisor's sheet
 * carries, and the reader that turns the sheet's grid into positions. No AI — a
 * column is read when its header matches one of the names below.
 *
 * PURE + CLIENT-SAFE. The Holdings tab imports the column list from here for its
 * copyable header row; the server reads the file into a grid and hands it to
 * `readHoldingsGrid`.
 */

type ImportField = "ticker" | "name" | "shares" | "price" | "marketValue" | "costBasis";
const NUMERIC_FIELDS = ["shares", "price", "marketValue", "costBasis"] as const;

/** The template's columns, in order, plus the names custodians export them under. */
export const HOLDINGS_IMPORT_COLUMNS: readonly {
  field: ImportField;
  header: string;
  aliases: readonly string[];
}[] = [
  { field: "ticker", header: "Ticker", aliases: ["symbol", "ticker symbol", "security symbol"] },
  {
    field: "name",
    header: "Name",
    aliases: ["description", "security", "security name", "security description", "holding", "investment name", "fund name"],
  },
  { field: "shares", header: "Shares", aliases: ["quantity", "qty", "units", "share quantity"] },
  {
    field: "price",
    header: "Price",
    aliases: ["share price", "price per share", "last price", "current price", "closing price", "market price", "unit price"],
  },
  {
    field: "marketValue",
    header: "Market Value",
    aliases: ["value", "mkt val", "mkt value", "market val", "current value", "total value"],
  },
  { field: "costBasis", header: "Cost Basis", aliases: ["basis", "cost", "total cost", "cost basis total", "total cost basis"] },
];

/** The header row, tab-separated so a paste into Excel fills one cell per column. */
export const HOLDINGS_IMPORT_HEADER_ROW = HOLDINGS_IMPORT_COLUMNS.map((c) => c.header).join("\t");

export const MAX_IMPORT_HOLDINGS = 500;

/** One position an import writes: the fields a holding stores, nothing else. */
export type ImportHolding = Pick<ExtractedHolding, ImportField>;

/** Whether an import clears the account's positions first, or adds after them. */
export type HoldingsImportMode = "replace" | "append";

export const HOLDINGS_IMPORT_SOURCES = ["spreadsheet", "statement"] as const;
export type HoldingsImportSource = (typeof HOLDINGS_IMPORT_SOURCES)[number];

/** The spreadsheet read route's answer: what was read, and a note per row passed over. */
export interface SpreadsheetRead {
  holdings: ImportHolding[];
  warnings: string[];
}

/** One account found on a statement. */
export interface StatementAccount {
  name: string;
  last4: string | null;
  holdings: ImportHolding[];
}

/** The statement read route's answer. `matchIndex` is the account whose last 4 match this one's. */
export interface StatementRead {
  accounts: StatementAccount[];
  matchIndex: number | null;
  warnings: string[];
}

// A holding row's displayTicker / displayName limits (holdingCreateSchema).
export const MAX_TICKER = 32;
export const MAX_NAME = 200;

/**
 * Keep only what an import writes, clamped to what a holding row stores. A cost
 * basis is an amount paid, so zero or a negative — a placeholder, or a
 * gain/loss figure — leaves the position with none.
 */
export function toImportHolding(h: ExtractedHolding): ImportHolding {
  const out: ImportHolding = {};
  const ticker = h.ticker?.trim().toUpperCase();
  if (ticker && ticker.length <= MAX_TICKER) out.ticker = ticker;
  const name = h.name?.trim();
  if (name) out.name = name.slice(0, MAX_NAME);
  for (const f of NUMERIC_FIELDS) {
    const v = h[f];
    if (v != null && Number.isFinite(v)) out[f] = v;
  }
  if (out.costBasis != null && !(out.costBasis > 0)) delete out.costBasis;
  return out;
}

/** Why a position can't be imported, or null when it can. Both sources skip on it. */
export function importProblem(h: ImportHolding): string | null {
  if (!h.ticker && !h.name) return "no ticker or name";
  if ([h.shares, h.price, h.marketValue].some((v) => v != null && v < 0)) return "negative shares, price or value";
  if (!((h.shares ?? 0) > 0) && !((h.marketValue ?? 0) > 0)) return "no shares or market value";
  return null;
}

/**
 * A statement's accounts as the import reviews them: each account's importable
 * positions (a warning per one passed over), and the one account, if exactly
 * one, whose last 4 match `last4` — the account being imported into.
 */
export function toStatementRead(
  read: readonly { name: string; accountNumberLast4?: string; holdings?: ExtractedHolding[] }[],
  last4: string | null,
  warnings: string[],
): StatementRead {
  const accounts: StatementAccount[] = [];
  for (const a of read) {
    const holdings: ImportHolding[] = [];
    for (const raw of a.holdings ?? []) {
      const h = toImportHolding(raw);
      const problem = importProblem(h);
      if (problem) warnings.push(`${a.name} (${h.ticker ?? h.name ?? "a position"}): ${problem} — skipped.`);
      else holdings.push(h);
    }
    if (holdings.length > 0) accounts.push({ name: a.name, last4: a.accountNumberLast4 ?? null, holdings });
  }
  if (accounts.length === 0) warnings.push("No holdings could be read off this document.");
  const matches = last4 ? accounts.flatMap((a, i) => (a.last4 === last4 ? [i] : [])) : [];
  return { accounts, matchIndex: matches.length === 1 ? matches[0] : null, warnings };
}

/** "Qty (Quantity)" → "qty", "Market Value ($)" → "market value". */
function headerKey(cell: unknown): string {
  return String(cell ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const FIELD_BY_KEY = new Map<string, ImportField>(
  HOLDINGS_IMPORT_COLUMNS.flatMap((c) =>
    [c.header, ...c.aliases].map((name) => [headerKey(name), c.field] as const),
  ),
);
const HEADER_BY_FIELD = new Map(HOLDINGS_IMPORT_COLUMNS.map((c) => [c.field, c.header]));

/** Custodian exports open with title lines; the header is somewhere near the top. */
const HEADER_SCAN_ROWS = 15;

type Columns = Partial<Record<ImportField, number>>;

/** The row's columns, when it reads as a header: a position's label plus a size. */
function headerColumns(row: readonly unknown[]): Columns | null {
  const cols: Columns = {};
  row.forEach((cell, i) => {
    const field = FIELD_BY_KEY.get(headerKey(cell));
    if (field && cols[field] == null) cols[field] = i;
  });
  const labelled = cols.ticker != null || cols.name != null;
  const sized = cols.shares != null || cols.marketValue != null;
  return labelled && sized ? cols : null;
}

const text = (cell: unknown) => String(cell ?? "").trim();

/** A whole-cell total or pending line. Whole-cell, so "Total Bond Market" stays. */
const SUMMARY_LINE = /^(?:(?:account|grand)\s+)?totals?:?$|^pending activity$/i;
const PLACEHOLDER = /^(?:-+|—|n\/?a)$/i;

/** A number off a cell: `$1,234.50`, `(50.00)` for −50, blank/`--`/`n/a` for none. */
function readAmount(cell: unknown): number | undefined | "unreadable" {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : undefined;
  const s = text(cell);
  if (s === "" || PLACEHOLDER.test(s)) return undefined;
  const parens = /^\((.*)\)$/.exec(s);
  const n = Number((parens ? parens[1] : s).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return "unreadable";
  return parens ? -n : n;
}

export type HoldingsGridResult =
  | { ok: true; holdings: ImportHolding[]; warnings: string[] }
  | { ok: false; error: string };

/** Read a sheet's grid (row 0 first) into positions, with a warning per row it couldn't take. */
export function readHoldingsGrid(grid: readonly (readonly unknown[])[]): HoldingsGridResult {
  const scanned = grid.slice(0, HEADER_SCAN_ROWS).map(headerColumns);
  const headerIndex = scanned.findIndex((c) => c != null);
  const cols = scanned[headerIndex];
  if (!cols) {
    return {
      ok: false,
      error: `Couldn't find the column headers. Put them in the first row: ${HOLDINGS_IMPORT_COLUMNS.map((c) => c.header).join(", ")}.`,
    };
  }

  const mapped = Object.values(cols);
  const holdings: ImportHolding[] = [];
  const warnings: string[] = [];

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i];
    if (mapped.every((c) => text(row[c]) === "")) continue;
    // Fidelity footnotes a money-market sweep as "SPAXX**".
    const ticker = cols.ticker != null ? text(row[cols.ticker]).replace(/\*+$/, "").toUpperCase() : "";
    const name = cols.name != null ? text(row[cols.name]) : "";
    if (SUMMARY_LINE.test(ticker) || SUMMARY_LINE.test(name)) continue;

    const rowLabel = `Row ${i + 1}${ticker || name ? ` (${ticker || name})` : ""}`;
    const raw: ExtractedHolding = { ticker, name };
    for (const f of NUMERIC_FIELDS) {
      const col = cols[f];
      if (col == null) continue;
      const v = readAmount(row[col]);
      if (v === "unreadable") {
        warnings.push(`${rowLabel}: couldn't read ${HEADER_BY_FIELD.get(f)} "${text(row[col])}" — left blank.`);
      } else if (v !== undefined) {
        raw[f] = v;
      }
    }
    const h = toImportHolding(raw);
    const problem = importProblem(h);
    if (problem) {
      warnings.push(`${rowLabel}: ${problem} — skipped.`);
      continue;
    }
    if (holdings.length === MAX_IMPORT_HOLDINGS) {
      warnings.push(`Only the first ${MAX_IMPORT_HOLDINGS} positions were read.`);
      break;
    }
    holdings.push(h);
  }

  return { ok: true, holdings, warnings };
}
