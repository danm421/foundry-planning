// src/lib/fact-finder/chat/view.ts
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { FACT_FINDER_SECTIONS, findSection, isListLike, type FFColumn, type FFSection } from "../schema";
import { cellNeedsCheck, isBlank, rowLabel } from "../state";
import { HOLDING_FIELDS, type FactFinderState, type FFCellValue, type FFHolding, type FFRow } from "../types";

/**
 * What the chat model sees of the fact finder. Every string that came from a
 * document, the advisor or a file name goes through `quote` (SSNs redacted,
 * JSON-quoted so its boundary is unambiguous). Numbers are printed as they
 * are. Callers fence the text before a model sees it.
 */

const TOP_HOLDINGS = 3;

export function quote(text: string): string {
  return JSON.stringify(redactSsns(text).text);
}

export function formatValue(value: FFCellValue): string {
  return typeof value === "string" ? quote(value) : String(value);
}

const percent = (score: number) => `${Math.round(score * 100)}%`;

function cellsText(section: FFSection, row: FFRow): string {
  const parts: string[] = [];
  for (const column of section.columns) {
    const cell = row.cells[column.id];
    if (!cell || isBlank(cell.value)) continue;
    parts.push(`${column.id}=${formatValue(cell.value)}${cellNeedsCheck(cell) ? " (check)" : ""}`);
  }
  return parts.length > 0 ? parts.join(" ") : "(no values)";
}

function linkText(row: FFRow): string {
  const candidates = row.linkCandidates ?? [];
  const link = row.link;
  let text: string;
  if (!link) {
    text = "not linked yet";
  } else if (link.kind === "new") {
    text = "links to a new record";
  } else {
    const label = candidates.find((c) => c.recordId === link.recordId)?.label;
    text =
      `links to ${label ? `${quote(label)} ` : ""}(${link.recordId})` +
      `${link.score === null ? "" : ` ${percent(link.score)}`}` +
      (link.confirmed ? " — confirmed" : " — needs a click");
  }
  if (candidates.length === 0) return text;
  return `${text}; candidates: ${candidates.map((c) => `${c.recordId} ${quote(c.label)} ${percent(c.score)}`).join(", ")}`;
}

function holdingValue(h: FFHolding): number {
  return h.marketValue ?? (h.shares !== null && h.price !== null ? h.shares * h.price : 0);
}

export function holdingName(h: FFHolding): string {
  return quote(h.ticker ?? h.name ?? "unnamed holding");
}

function holdingsText(holdings: readonly FFHolding[]): string {
  const total = holdings.reduce((sum, h) => sum + holdingValue(h), 0);
  const largest = [...holdings]
    .sort((a, b) => holdingValue(b) - holdingValue(a))
    .slice(0, TOP_HOLDINGS)
    .map(holdingName);
  const count = `${holdings.length} holding${holdings.length === 1 ? "" : "s"}`;
  return `${count}, total ${Math.round(total)}, largest ${largest.join(", ")}`;
}

function rowLine(section: FFSection, row: FFRow): string {
  const parts = [`- ${row.id} ${quote(rowLabel(section, row))}: ${cellsText(section, row)}`];
  if (section.links) parts.push(linkText(row));
  if (row.holdings?.length) parts.push(holdingsText(row.holdings));
  return parts.join(" | ");
}

function holdingLine(h: FFHolding): string {
  const fields = HOLDING_FIELDS.filter((f) => h[f] !== null).map((f) => `${f}=${formatValue(h[f])}`);
  return `  - holding ${h.id}: ${fields.join(" ")}`;
}

function sectionBlock(state: FactFinderState, section: FFSection): string {
  const lines = (state.sections[section.id] ?? []).map((row) => rowLine(section, row));
  return [`## ${section.id} — ${section.label}`, ...(lines.length > 0 ? lines : ["(no rows)"])].join("\n");
}

function readingText(state: FactFinderState, fileId: string): string {
  const reading = state.readings[fileId];
  if (!reading) return "not read yet";
  if (reading.status === "reading") return "reading now";
  if (reading.status === "failed") return `couldn't be read — ${quote(reading.reason ?? "no reason given")}`;
  return `read (${reading.rows ?? 0} rows)`;
}

const block = (title: string, lines: string[]) => [`## ${title}`, ...(lines.length > 0 ? lines : ["(none)"])].join("\n");

/**
 * The whole fact finder, token-budgeted (spec § 5): each live row with its id,
 * label and FILLED cells only, its link and candidates, holdings summarized per
 * account; then the Removed tray, holdings with no account, and each
 * document's reading. `read_section` shows a section in full.
 */
export function factFinderView(state: FactFinderState, files: { id: string; name: string }[]): string {
  const documents = files.map((f) => `- ${quote(f.name)}: ${readingText(state, f.id)}`);
  const sections = FACT_FINDER_SECTIONS.map((section) => sectionBlock(state, section));
  const tray = state.removed.map((e) => {
    const section = findSection(e.sectionId);
    const label = section ? rowLabel(section, e.row) : e.row.id;
    return `- ${e.row.id} in ${e.sectionId} ${quote(label)} — removed: ${quote(e.reason)}`;
  });
  const unassigned = state.unassignedHoldings.map(
    (h) => `- ${h.id} ${holdingName(h)}, value ${Math.round(holdingValue(h))} — account hint ${quote(h.accountHint)}`,
  );
  return [
    block("Documents", documents),
    ...sections,
    block("Removed tray", tray),
    block("Holdings with no account", unassigned),
  ].join("\n\n");
}

function columnText(column: FFColumn): string {
  const kind = column.options ? `choice: ${column.options.map((o) => JSON.stringify(o)).join(" | ")}` : column.kind;
  return `${column.id} ${JSON.stringify(column.label)} (${kind})`;
}

/** One section in full: its columns (with each choice's options), every row with every holding's id, and its removed rows. */
export function sectionView(state: FactFinderState, sectionId: string): string {
  const section = findSection(sectionId);
  if (!section) throw new Error(`There's no fact finder section "${sectionId}".`);
  const rows = (state.sections[section.id] ?? []).flatMap((row) => [rowLine(section, row), ...(row.holdings ?? []).map(holdingLine)]);
  const removed = state.removed
    .filter((e) => e.sectionId === section.id)
    .map((e) => `- ${e.row.id} ${quote(rowLabel(section, e.row))} — removed: ${quote(e.reason)} | ${cellsText(section, e.row)}`);
  return [
    `## ${section.id} — ${section.label}`,
    isListLike(section) ? "Rows can be added, removed and merged." : "Fixed rows: fill them in — they can't be added or removed.",
    ...(section.hint ? [`Hint: ${section.hint}`] : []),
    `Columns: ${section.columns.map(columnText).join("; ")}`,
    "Rows:",
    ...(rows.length > 0 ? rows : ["(no rows)"]),
    ...(removed.length > 0 ? ["Removed from this section:", ...removed] : []),
  ].join("\n");
}
