// src/lib/fact-finder/chat/tools.ts
import { z } from "zod";
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { applyOps, type ClientOp } from "../ops";
import { FACT_FINDER_SECTIONS, findColumn, findSection, isListLike, type FFSection } from "../schema";
import { isBlank, locateRow, rowLabel } from "../state";
import { HOLDING_FIELDS, type FactFinderState, type FFCell, type FFHolding, type FFRow } from "../types";
import { fenceUntrusted } from "./fence";
import { formatValue, holdingName, quote, sectionView } from "./view";

/**
 * The chat's tools (spec § 5). Each validates its arguments, turns them into
 * the same `ClientOp`s the screen sends, and checks them by applying them to
 * the state it was given — the turn loop applies them for real. Reading tools
 * (`read_section`, `explain`, `reread_document`) return no ops. There is no
 * save tool: the chat can only edit the fact finder.
 */

export interface ToolContext {
  /** The import's live files, for document names. */
  files: { id: string; name: string }[];
  /** A file's page text, SSNs already redacted. */
  readDocument: (fileId: string) => Promise<string[]>;
  newId: () => string;
}

export interface ToolOutcome {
  ops: ClientOp[];
  /** The transcript's tool line. */
  summary: string;
  /** What the model sees, fenced. */
  result: string;
}

/** The most document text `reread_document` hands the model at once. */
export const REREAD_MAX_CHARS = 20_000;

const LIST_SECTION_IDS = FACT_FINDER_SECTIONS.filter(isListLike).map((s) => s.id);
const SECTION_IDS = FACT_FINDER_SECTIONS.map((s) => s.id);

type Param = { type?: string; description: string; enum?: readonly string[] };

function fn(name: string, description: string, properties: Record<string, Param>, required: string[]) {
  return { type: "function" as const, function: { name, description, parameters: { type: "object", properties, required } } };
}

const rowIdParam: Param = { type: "string", description: "The row's id, as the fact finder shows it." };
const columnIdParam: Param = { type: "string", description: "The column's id, as the fact finder or read_section shows it." };
const holdingIdParam: Param = { type: "string", description: "The holding's id, as read_section shows it." };

/** OpenAI-style function defs, bound with `bindTools`. Exported for the schema test. */
export const TOOL_DEFS = [
  fn(
    "set_cell",
    "Write one value into one cell of a row. Write it as the advisor would type it: dollars as 12500, " +
      "a percent as 6.5 for 6.5%, a date as YYYY-MM-DD, a month as YYYY-MM, a year as 2027, a choice as " +
      "one of the column's options, a check box as true or false. A value that doesn't fit the column is " +
      "refused with the reason. read_section lists a section's columns and options.",
    {
      rowId: rowIdParam,
      columnId: columnIdParam,
      value: { description: "The value, as text, a number or true/false." },
    },
    ["rowId", "columnId", "value"],
  ),
  fn(
    "clear_cell",
    "Empty one cell. It stays empty: later document reads won't fill it again.",
    { rowId: rowIdParam, columnId: columnIdParam },
    ["rowId", "columnId"],
  ),
  fn(
    "add_row",
    "Add a row to a section that holds a list (an account, a debt, an income, a policy, a person …) " +
      "with the values you know. Returns the new row's id. Sections with fixed rows (the Client and " +
      "Co-client details, salaries, Social Security, notes …) already have their rows: use set_cell on those.",
    {
      sectionId: { type: "string", description: "The section to add the row to.", enum: LIST_SECTION_IDS },
      cells: { type: "object", description: "The row's values: column id → value, written as set_cell expects." },
    },
    ["sectionId", "cells"],
  ),
  fn(
    "remove_row",
    "Move a row to the Removed tray, with a reason the advisor sees. Nothing is deleted: restore_row brings it back.",
    { rowId: rowIdParam, reason: { type: "string", description: "Why the row doesn't belong, in a few words." } },
    ["rowId", "reason"],
  ),
  fn(
    "restore_row",
    "Bring a row back from the Removed tray to its section.",
    { rowId: { type: "string", description: "The row's id, as the Removed tray shows it." } },
    ["rowId"],
  ),
  fn(
    "merge_rows",
    "Combine two rows of the same section that are the same thing seen twice. The kept row's values " +
      "win; the other row's values fill the kept row's empty cells, and the other row goes to the Removed tray.",
    {
      keepRowId: { type: "string", description: "The row to keep." },
      dropRowId: { type: "string", description: "The row to fold into it." },
    },
    ["keepRowId", "dropRowId"],
  ),
  fn(
    "set_link",
    "Choose what a row becomes when the plan is updated: one of the existing records listed as its " +
      'candidates (kind "existing" with that record id), or a new record (kind "new").',
    {
      rowId: rowIdParam,
      kind: { type: "string", description: "existing or new.", enum: ["existing", "new"] },
      recordId: { type: "string", description: 'The candidate\'s record id. Only for kind "existing".' },
    },
    ["rowId", "kind"],
  ),
  fn(
    "set_holding",
    "Correct one field of one holding (a position inside an investment account).",
    {
      holdingId: holdingIdParam,
      field: { type: "string", description: "The field to change.", enum: HOLDING_FIELDS },
      value: { description: "Text for ticker and name; a number otherwise." },
    },
    ["holdingId", "field", "value"],
  ),
  fn(
    "remove_holding",
    "Remove one holding from its account. Later document reads won't add it back.",
    { holdingId: holdingIdParam },
    ["holdingId"],
  ),
  fn(
    "move_holding",
    "Move a holding to another account row. This is also how a holding with no account gets one. " +
      "Only taxable, retirement and education accounts carry holdings.",
    { holdingId: holdingIdParam, toRowId: { type: "string", description: "The account row to move it to." } },
    ["holdingId", "toRowId"],
  ),
  fn(
    "read_section",
    "Show one section in full: its columns with each choice column's options, every row, and every " +
      "holding with its id. The fact finder above shows only filled cells and a summary of holdings.",
    { sectionId: { type: "string", description: "The section to show.", enum: SECTION_IDS } },
    ["sectionId"],
  ),
  fn(
    "reread_document",
    "Look in one uploaded document for something the fact finder doesn't show. Returns the document's " +
      "pages most related to your question, best first. Name the document exactly as the fact finder's " +
      "Documents list shows it.",
    {
      fileName: { type: "string", description: "The document's name, as the Documents list shows it." },
      question: { type: "string", description: "What to look for." },
    },
    ["fileName", "question"],
  ),
  fn(
    "explain",
    "Say where a row's values came from: which document and page and how sure the reading was, or " +
      "whether the advisor or this chat wrote them.",
    { rowId: { type: "string", description: "The row's id, in the fact finder or the Removed tray." } },
    ["rowId"],
  ),
];

const id = z.string().min(1).max(100);
const value = z.union([z.string(), z.number(), z.boolean()]);
const ARGS = {
  set_cell: z.object({ rowId: id, columnId: id, value }),
  clear_cell: z.object({ rowId: id, columnId: id }),
  add_row: z.object({ sectionId: z.enum(LIST_SECTION_IDS), cells: z.record(z.string(), value) }),
  remove_row: z.object({ rowId: id, reason: z.string().trim().min(1).max(500) }),
  restore_row: z.object({ rowId: id }),
  merge_rows: z.object({ keepRowId: id, dropRowId: id }),
  set_link: z.object({ rowId: id, kind: z.enum(["existing", "new"]), recordId: id.optional() }),
  set_holding: z.object({ holdingId: id, field: z.enum(HOLDING_FIELDS), value: z.union([z.string(), z.number()]) }),
  remove_holding: z.object({ holdingId: id }),
  move_holding: z.object({ holdingId: id, toRowId: id }),
  read_section: z.object({ sectionId: z.enum(SECTION_IDS) }),
  reread_document: z.object({ fileName: z.string().min(1), question: z.string().min(1).max(500) }),
  explain: z.object({ rowId: id }),
};
type ToolName = keyof typeof ARGS;

function argsOf<N extends ToolName>(name: N, args: unknown): z.infer<(typeof ARGS)[N]> {
  const parsed = ARGS[name].safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${name} got bad arguments: ${issue?.path.join(".") || "arguments"} — ${issue?.message ?? "invalid"}.`);
  }
  return parsed.data as z.infer<(typeof ARGS)[N]>;
}

function liveRow(state: FactFinderState, rowId: string): { section: FFSection; row: FFRow } {
  const at = locateRow(state, rowId);
  const section = at ? findSection(at.sectionId) : undefined;
  if (!at || !section) throw new Error(`There's no row "${rowId}" in the fact finder. Use a row id the fact finder shows.`);
  return { section, row: state.sections[at.sectionId][at.index] };
}

/** A holding and the account row it sits in (`null` = it has no account yet). */
function findHolding(state: FactFinderState, holdingId: string): { holding: FFHolding; account: { section: FFSection; row: FFRow } | null } {
  for (const section of FACT_FINDER_SECTIONS) {
    if (!section.holdings) continue;
    for (const row of state.sections[section.id] ?? []) {
      const holding = row.holdings?.find((h) => h.id === holdingId);
      if (holding) return { holding, account: { section, row } };
    }
  }
  const holding = state.unassignedHoldings.find((h) => h.id === holdingId);
  if (holding) return { holding, account: null };
  throw new Error(`There's no holding "${holdingId}". read_section lists every holding with its id.`);
}

function holdingInAccount(state: FactFinderState, holdingId: string): { holding: FFHolding; section: FFSection; row: FFRow } {
  const { holding, account } = findHolding(state, holdingId);
  if (!account) throw new Error("That holding isn't in an account yet — use move_holding to give it one first.");
  return { holding, ...account };
}

/** Applies the ops to the given state, so a bad value is refused here with the schema's own message. */
function edit(state: FactFinderState, ops: ClientOp[], ctx: ToolContext, describe: (next: FactFinderState) => string): ToolOutcome {
  const next = applyOps(state, ops, { by: "chat", now: new Date().toISOString(), newId: ctx.newId });
  const summary = describe(next);
  return { ops, summary, result: fenceUntrusted(`Done: ${summary}.`) };
}

const STOP_WORDS = new Set([
  "the", "and", "for", "what", "which", "when", "where", "who", "how", "does", "did", "with", "from",
  "this", "that", "are", "was", "her", "his", "their", "its", "about", "any", "all", "has", "have",
  "there", "show", "find", "look",
]);

function keywords(question: string): string[] {
  const words = question.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words)].filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/** Pages ranked by how many of the question's words they hold (page order on a tie), cut off at `budget` characters. */
function rankedPages(pages: string[], question: string, budget: number): string {
  const words = keywords(question);
  const ranked = pages
    .map((text, i) => ({ text: text.trim(), page: i + 1 }))
    .filter((p) => p.text !== "")
    .map((p) => ({ ...p, hits: words.filter((w) => p.text.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.hits - a.hits);
  let out = "";
  for (const p of ranked) {
    const next = `${out === "" ? "" : "\n\n"}[page ${p.page}]\n${p.text}`;
    if (out.length + next.length > budget) return out + next.slice(0, budget - out.length);
    out += next;
  }
  return out;
}

const sameName = (a: string, b: string) => redactSsns(a).text.trim().toLowerCase() === redactSsns(b).text.trim().toLowerCase();

async function rereadDocument(args: z.infer<typeof ARGS.reread_document>, ctx: ToolContext): Promise<ToolOutcome> {
  const file = ctx.files.find((f) => sameName(f.name, args.fileName));
  if (!file) {
    const names = ctx.files.map((f) => quote(f.name)).join(", ") || "none";
    throw new Error(`There's no document named ${quote(args.fileName)}. The documents are: ${names}.`);
  }
  const pages = (await ctx.readDocument(file.id)).map((p) => redactSsns(p).text);
  const header = `From ${quote(file.name)}, most relevant pages first:\n`;
  const body = rankedPages(pages, args.question, REREAD_MAX_CHARS - header.length);
  return {
    ops: [],
    summary: `Looked in ${quote(file.name)} for: ${quote(args.question)}`,
    result: fenceUntrusted(header + (body || "(this document has no readable text)")),
  };
}

function sourceText(cell: FFCell, fileName: (fileId: string) => string): string {
  if (cell.by === "advisor") return "typed by the advisor";
  if (cell.by === "chat") return "set in this chat";
  if (!cell.source) return "from a document";
  const parts = [`from ${quote(fileName(cell.source.fileId))}`];
  if (cell.source.page !== undefined) parts.push(`page ${cell.source.page}`);
  if (cell.confidence !== undefined) parts.push(`${Math.round(cell.confidence * 100)}% sure`);
  const snippet = cell.source.snippet ? ` — ${quote(cell.source.snippet.slice(0, 200))}` : "";
  return parts.join(", ") + snippet;
}

function explainRow(state: FactFinderState, rowId: string, ctx: ToolContext): ToolOutcome {
  const at = locateRow(state, rowId);
  const entry = at ? undefined : state.removed.find((e) => e.row.id === rowId);
  const sectionId = at?.sectionId ?? entry?.sectionId;
  const section = sectionId ? findSection(sectionId) : undefined;
  const row = at ? state.sections[at.sectionId][at.index] : entry?.row;
  if (!section || !row) throw new Error(`There's no row "${rowId}" in the fact finder or the Removed tray.`);

  const fileName = (fileId: string) => ctx.files.find((f) => f.id === fileId)?.name ?? "a document no longer in this import";
  const label = quote(rowLabel(section, row));
  const lines = [`${label} — row ${row.id} in ${section.label}${entry ? ` (in the Removed tray: ${quote(entry.reason)})` : ""}`];
  for (const column of section.columns) {
    const cell = row.cells[column.id];
    if (!cell || isBlank(cell.value)) continue;
    lines.push(`- ${column.id}=${formatValue(cell.value)}: ${sourceText(cell, fileName)}`);
  }
  if (row.sourceFileIds.length > 0) lines.push(`Documents: ${row.sourceFileIds.map((f) => quote(fileName(f))).join(", ")}`);
  if (row.statementDate) lines.push(`Statement date: ${row.statementDate}`);
  return { ops: [], summary: `Explained ${label}`, result: fenceUntrusted(lines.join("\n")) };
}

async function dispatch(name: string, raw: unknown, state: FactFinderState, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case "set_cell": {
      const a = argsOf(name, raw);
      const { section, row } = liveRow(state, a.rowId);
      const ops: ClientOp[] = [{ op: "setCell", sectionId: section.id, rowId: row.id, columnId: a.columnId, value: a.value }];
      return edit(state, ops, ctx, (next) => {
        const stored = next.sections[section.id].find((r) => r.id === row.id)?.cells[a.columnId]?.value ?? null;
        return `Set ${findColumn(section.id, a.columnId)?.label} on ${quote(rowLabel(section, row))} to ${formatValue(stored)}`;
      });
    }
    case "clear_cell": {
      const a = argsOf(name, raw);
      const { section, row } = liveRow(state, a.rowId);
      const ops: ClientOp[] = [{ op: "clearCell", sectionId: section.id, rowId: row.id, columnId: a.columnId }];
      return edit(state, ops, ctx, () => `Cleared ${findColumn(section.id, a.columnId)?.label} on ${quote(rowLabel(section, row))}`);
    }
    case "add_row": {
      const a = argsOf(name, raw);
      const section = findSection(a.sectionId)!;
      const rowId = ctx.newId();
      const ops: ClientOp[] = [{ op: "addRow", sectionId: section.id, rowId, cells: a.cells }];
      const outcome = edit(state, ops, ctx, (next) => {
        const added = next.sections[section.id].find((r) => r.id === rowId)!;
        return `Added ${quote(rowLabel(section, added))} to ${section.label}`;
      });
      return { ...outcome, result: fenceUntrusted(`Done: ${outcome.summary}. New row id: ${rowId}.`) };
    }
    case "remove_row": {
      const a = argsOf(name, raw);
      const { section, row } = liveRow(state, a.rowId);
      const ops: ClientOp[] = [{ op: "removeRow", sectionId: section.id, rowId: row.id, reason: a.reason }];
      return edit(state, ops, ctx, () => `Moved ${quote(rowLabel(section, row))} to the Removed tray: ${quote(a.reason)}`);
    }
    case "restore_row": {
      const a = argsOf(name, raw);
      const entry = state.removed.find((e) => e.row.id === a.rowId);
      const section = entry ? findSection(entry.sectionId) : undefined;
      if (!entry || !section) throw new Error("That row isn't in the Removed tray.");
      return edit(state, [{ op: "restoreRow", rowId: a.rowId }], ctx, () => `Restored ${quote(rowLabel(section, entry.row))} to ${section.label}`);
    }
    case "merge_rows": {
      const a = argsOf(name, raw);
      const keep = liveRow(state, a.keepRowId);
      const drop = liveRow(state, a.dropRowId);
      if (keep.section.id !== drop.section.id) {
        throw new Error(
          `Only rows of the same section can be merged — those are in ${keep.section.label} and ${drop.section.label}.`,
        );
      }
      const ops: ClientOp[] = [{ op: "mergeRows", sectionId: keep.section.id, keepRowId: keep.row.id, dropRowId: drop.row.id }];
      return edit(
        state,
        ops,
        ctx,
        () => `Merged ${quote(rowLabel(drop.section, drop.row))} into ${quote(rowLabel(keep.section, keep.row))}`,
      );
    }
    case "set_link": {
      const a = argsOf(name, raw);
      const { section, row } = liveRow(state, a.rowId);
      if (!section.links) throw new Error(`${section.label} rows don't link to records.`);
      const label = quote(rowLabel(section, row));
      if (a.kind === "new") {
        const ops: ClientOp[] = [{ op: "setLink", sectionId: section.id, rowId: row.id, link: { kind: "new" } }];
        return edit(state, ops, ctx, () => `${label} will be a new record`);
      }
      if (!a.recordId) throw new Error('set_link needs a recordId when kind is "existing".');
      const candidates = row.linkCandidates ?? [];
      const candidate = candidates.find((c) => c.recordId === a.recordId);
      if (!candidate) {
        if (candidates.length === 0) {
          throw new Error(`${label} has no candidates to link to — use kind "new", or leave the link to the advisor.`);
        }
        throw new Error(`"${a.recordId}" isn't one of the candidates for ${label}: ${candidates.map((c) => c.recordId).join(", ")}.`);
      }
      const ops: ClientOp[] = [
        { op: "setLink", sectionId: section.id, rowId: row.id, link: { kind: "existing", recordId: candidate.recordId } },
      ];
      return edit(state, ops, ctx, () => `Linked ${label} to ${quote(candidate.label)}`);
    }
    case "set_holding": {
      const a = argsOf(name, raw);
      const { holding, section, row } = holdingInAccount(state, a.holdingId);
      const ops: ClientOp[] = [
        { op: "setHolding", sectionId: section.id, rowId: row.id, holdingId: holding.id, field: a.field, value: a.value },
      ];
      return edit(state, ops, ctx, (next) => {
        const stored = next.sections[section.id].find((r) => r.id === row.id)?.holdings?.find((h) => h.id === holding.id);
        const where = quote(rowLabel(section, row));
        return `Set ${a.field} of ${holdingName(holding)} in ${where} to ${formatValue(stored?.[a.field] ?? null)}`;
      });
    }
    case "remove_holding": {
      const a = argsOf(name, raw);
      const { holding, section, row } = holdingInAccount(state, a.holdingId);
      const ops: ClientOp[] = [{ op: "removeHolding", sectionId: section.id, rowId: row.id, holdingId: holding.id }];
      return edit(state, ops, ctx, () => `Removed ${holdingName(holding)} from ${quote(rowLabel(section, row))}`);
    }
    case "move_holding": {
      const a = argsOf(name, raw);
      const { holding, account } = findHolding(state, a.holdingId);
      const to = liveRow(state, a.toRowId);
      if (account?.row.id === to.row.id) throw new Error(`That holding is already in ${quote(rowLabel(to.section, to.row))}.`);
      const from = account ? { sectionId: account.section.id, rowId: account.row.id } : ("unassigned" as const);
      const ops: ClientOp[] = [
        { op: "assignHolding", holdingId: holding.id, from, to: { sectionId: to.section.id, rowId: to.row.id } },
      ];
      return edit(state, ops, ctx, () => `Moved ${holdingName(holding)} to ${quote(rowLabel(to.section, to.row))}`);
    }
    case "read_section": {
      const a = argsOf(name, raw);
      return { ops: [], summary: `Read ${findSection(a.sectionId)!.label}`, result: fenceUntrusted(sectionView(state, a.sectionId)) };
    }
    case "reread_document":
      return rereadDocument(argsOf(name, raw), ctx);
    case "explain":
      return explainRow(state, argsOf(name, raw).rowId, ctx);
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

/**
 * Runs one tool call against `state`. Throws an `Error` whose message the
 * model can act on (an unknown row, column or section, or a value the column
 * refuses); every message, summary and result has its SSNs redacted.
 */
export async function runTool(name: string, args: unknown, state: FactFinderState, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    return await dispatch(name, args, state, ctx);
  } catch (err) {
    throw new Error(redactSsns(err instanceof Error ? err.message : "That tool call failed.").text);
  }
}
