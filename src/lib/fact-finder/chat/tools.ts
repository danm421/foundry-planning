// src/lib/fact-finder/chat/tools.ts
import { z } from "zod";
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { applyOps, type ClientOp } from "../ops";
import { FACT_FINDER_SECTIONS, findColumn, findSection, isListLike, type FFSection } from "../schema";
import { locateRow, rowLabel } from "../state";
import { HOLDING_FIELDS, type FactFinderState, type FFHolding, type FFRow } from "../types";
import { fenceUntrusted } from "./fence";
import { formatValue, holdingName, quote, sectionView } from "./view";

/**
 * The chat's tools (spec § 5). Each validates its arguments, turns them into
 * the same `ClientOp`s the screen sends, and checks them by applying them to
 * the state it was given — the turn loop applies them for real. Reading tools
 * (`read_section`) return no ops. There is no
 * save tool: the chat can only edit the fact finder.
 */

export interface ToolContext {
  /** The import's live files, for document names. */
  files: { id: string; name: string }[];
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

/** A JSON-schema property, as much of it as the tool defs use. */
export type Param = {
  type?: string;
  description: string;
  enum?: readonly string[];
  items?: Param;
  properties?: Record<string, Param>;
  required?: string[];
};

export function fn(name: string, description: string, properties: Record<string, Param>, required: string[]) {
  return { type: "function" as const, function: { name, description, parameters: { type: "object", properties, required } } };
}

const rowIdParam: Param = { type: "string", description: "The row's id, as the fact finder shows it." };
const columnIdParam: Param = { type: "string", description: "The column's id, as the fact finder or read_section shows it." };
const holdingIdParam: Param = { type: "string", description: "The holding's id, as read_section shows it." };

/** A new holding's values as a tool takes them (add_holding, the worksheet's stage_rows). */
export const HOLDING_INPUT_PARAMS: Record<string, Param> = {
  ticker: { type: "string", description: "The ticker, if it has one." },
  name: { type: "string", description: "The security's name." },
  shares: { type: "number", description: "How many shares." },
  price: { type: "number", description: "The price per share, in dollars." },
  marketValue: { type: "number", description: "The market value, in dollars." },
  costBasis: { type: "number", description: "The cost basis, in dollars." },
};

/** The tools that edit or read staging, shared with the worksheet chat (`worksheet/tools.ts`). */
export const STAGING_TOOL_DEFS = [
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
    "add_holding",
    "Add a holding (a position) to a taxable, retirement or education account row, with the values you " +
      "know: a ticker or a name, and any of shares, price, market value and cost basis. Returns the new holding's id.",
    {
      rowId: { type: "string", description: "The account row to add it to." },
      ...HOLDING_INPUT_PARAMS,
    },
    ["rowId"],
  ),
  fn(
    "read_section",
    "Show one section in full: its columns with each choice column's options, every row, and every " +
      "holding with its id. The fact finder above shows only filled cells and a summary of holdings.",
    { sectionId: { type: "string", description: "The section to show.", enum: SECTION_IDS } },
    ["sectionId"],
  ),
];

const id = z.string().min(1).max(100);
const value = z.union([z.string(), z.number(), z.boolean()]);
const amount = z.union([z.string(), z.number()]).nullish();

/** HOLDING_INPUT_PARAMS' zod shape; refine the object with `hasTickerOrName`. */
export const HOLDING_INPUT_FIELDS = {
  ticker: z.string().max(100).nullish(),
  name: z.string().max(300).nullish(),
  shares: amount,
  price: amount,
  marketValue: amount,
  costBasis: amount,
};
export const hasTickerOrName = (h: { ticker?: string | null; name?: string | null }) => !!h.ticker?.trim() || !!h.name?.trim();
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
  add_holding: z.object({ rowId: id, ...HOLDING_INPUT_FIELDS }).refine(hasTickerOrName, "give a ticker or a name"),
  read_section: z.object({ sectionId: z.enum(SECTION_IDS) }),
};
type ToolName = keyof typeof ARGS;

/** Validates a tool's arguments; a failure throws a message naming the bad argument. */
export function parseArgs<S extends z.ZodType>(name: string, schema: S, args: unknown): z.infer<S> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${name} got bad arguments: ${issue?.path.join(".") || "arguments"} — ${issue?.message ?? "invalid"}.`);
  }
  return parsed.data;
}

function argsOf<N extends ToolName>(name: N, args: unknown): z.infer<(typeof ARGS)[N]> {
  return parseArgs(name, ARGS[name], args) as z.infer<(typeof ARGS)[N]>;
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

const sameName = (a: string, b: string) => redactSsns(a).text.trim().toLowerCase() === redactSsns(b).text.trim().toLowerCase();

/** The import's file named `name` (trimmed, any case); a miss throws naming the files there are. */
export function findDocument(files: ToolContext["files"], name: string): ToolContext["files"][number] {
  const file = files.find((f) => sameName(f.name, name));
  if (!file) {
    const names = files.map((f) => quote(f.name)).join(", ") || "none";
    throw new Error(`There's no document named ${quote(name)}. The documents are: ${names}.`);
  }
  return file;
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
      // A keep-open save linked the row to the record it wrote: relinking it would add that record again on the next save.
      const link = row.link;
      const saved = link?.kind === "existing" ? state.applied?.find((x) => x.rowId === row.id && x.recordId === link.recordId) : undefined;
      if (saved) throw new Error(`${label} is already in the plan as ${quote(saved.label)} — leave its link as it is.`);
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
    case "add_holding": {
      const { rowId, ...holding } = argsOf(name, raw);
      const { section, row } = liveRow(state, rowId);
      const holdingId = ctx.newId();
      const ops: ClientOp[] = [{ op: "addHolding", sectionId: section.id, rowId: row.id, holdingId, holding }];
      const outcome = edit(state, ops, ctx, (next) => {
        const added = next.sections[section.id].find((r) => r.id === row.id)!.holdings!.find((h) => h.id === holdingId)!;
        return `Added ${holdingName(added)} to ${quote(rowLabel(section, row))}`;
      });
      return { ...outcome, result: fenceUntrusted(`Done: ${outcome.summary}. New holding id: ${holdingId}.`) };
    }
    case "read_section": {
      const a = argsOf(name, raw);
      return { ops: [], summary: `Read ${findSection(a.sectionId)!.label}`, result: fenceUntrusted(sectionView(state, a.sectionId)) };
    }
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
