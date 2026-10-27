// src/lib/fact-finder/worksheet/turn.ts
import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { chatModel } from "@/domain/forge/llm";
import { recordMessageUsage } from "@/lib/ai/usage";
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { fenceUntrusted } from "../chat/fence";
import { rebaseOps } from "../client-ops";
import { applyLinkScores } from "../matching/score";
import { FactFinderOpError, countOps, diffSnapshots, locationOf, type OpContext } from "../ops";
import { FactFinderNotFoundError, listLiveFiles, loadFactFinder, updateFactFinder, type FactFinderScope } from "../persist";
import { runLeftovers } from "../placement/leftovers-run";
import { loadBaseCaseRecords } from "../relink";
import { reviewFactFinder } from "../review";
import { locateRow, sameJson } from "../state";
import type { FactFinderState, FFChatTurn, FFSnapshot } from "../types";
import { composeRequest } from "./compose";
import { lookAtPages } from "./look";
import { WorksheetOpError } from "./ops";
import { documentPages } from "./page-text";
import { planView } from "./plan-view";
import { worksheetSystemPrompt } from "./prompt";
import { rowInPlan } from "./render";
import { WS_TOOL_DEFS, refusedLine, runWorksheetTool, type WsToolContext } from "./tools";
import { applyTurnOps, type TurnOp } from "./turn-ops";

/**
 * One worksheet chat reply. The model's tool calls edit a WORKING copy of the
 * fact finder — worksheet and staging — so a later call sees an earlier one,
 * and every round's system prompt shows it. The reply then commits by
 * replaying the same ops on the fresh state in ONE compare-and-set. An edit
 * that landed meanwhile elsewhere is kept; if anything a staging op of the
 * reply touches changed meanwhile, or one of its ops no longer applies,
 * nothing from the reply applies, and it says so. A compose turn is the same loop,
 * asked to fold newly read documents into the tables. Rows the model proposes
 * go to the review after the commit; nothing here writes to the plan.
 */

export const MAX_WS_TOOL_CALLS = 40;
/** The route's maxDuration: the reply, its commit and a review it chains all end inside it. */
export const TURN_LIMIT_MS = 300_000;
/** No new model round starts after this long. */
export const WS_TURN_BUDGET_MS = 240_000;
/** …nor after this long on a turn that will chain a review (a Match, or once the model proposes), so the review fits. */
export const WS_REVIEW_TURN_BUDGET_MS = 150_000;
/** What a chained review needs: up to 90 s of leftovers AI (`runLeftovers`), the record book and the writes. */
export const REVIEW_RESERVE_MS = 110_000;
/** What the commit needs once the last model call or tool call ends; both are cut off to leave it. */
const COMMIT_RESERVE_MS = 20_000;
/** Replies that keep their Undo; older ones lose it. */
const MAX_UNDO_REPLIES = 10;
const OUT_OF_STEPS = "I ran out of steps for one reply — ask me to carry on.";
const OUT_OF_TIME = "I ran out of time for one reply — ask me to carry on.";
const NO_TIME_TO_PROPOSE = "I ran out of time to put the change list together — ask me to propose it again.";
const CHANGED_MEANWHILE = "The worksheet changed while I was working on that — ask me again.";

/** `chatModel()`'s shape, narrow enough for a test double. */
export interface TurnModel {
  bindTools(defs: unknown[]): { invoke(messages: BaseMessage[], options?: { timeout?: number }): Promise<AIMessage> };
}

class OutOfTime extends Error {}

/** `work`, or OutOfTime once `ms` pass. A tool call can't be aborted, so it runs on unawaited; its result is dropped. */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OutOfTime()), Math.max(0, ms));
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export interface WorksheetTurnArgs {
  scope: FactFinderScope;
  /** "compose": fold the documents read but not yet composed into the worksheet. */
  mode: "advisor" | "compose";
  /** The advisor's words; required for "advisor". */
  message?: string;
  /** "Match to plan" on a table (or, with no id, every table): its rows already in the plan are always proposed. */
  match?: { tableId?: string };
  model?: TurnModel;
  toolContext?: Partial<WsToolContext>;
  /** A test seam. */
  review?: typeof reviewFactFinder;
  now?: () => Date;
  /** Each tool line, as it happens. */
  onProgress?: (line: string) => void;
}

export interface WorksheetTurnResult {
  factFinder: FactFinderState;
  /** The reply's assistant turn id when it changed something (its Undo), else null. */
  turnId: string | null;
  toolCallCount: number;
  /** The ops the reply applied, counted by kind (for the audit). */
  ops: Record<string, number>;
}

/**
 * Earlier turns as history, SSNs redacted again. Every assistant and tool turn
 * is fenced as data: a read summary is stored as an assistant turn and quotes
 * a document's row or file name. Only the advisor's own words stay unfenced.
 */
export function transcriptToMessages(transcript: readonly FFChatTurn[]): BaseMessage[] {
  const clean = (text: string) => redactSsns(text).text;
  return transcript.map((t) => {
    if (t.role === "user") return new HumanMessage(clean(t.text));
    if (t.role === "assistant") return new AIMessage(fenceUntrusted(clean(t.text)));
    if (t.role === "proposal") return new AIMessage(fenceUntrusted("[proposed plan changes]"));
    return new AIMessage(fenceUntrusted(`[used ${t.tool}] ${clean(t.summary)}`));
  });
}

/** The undo entries of the latest replies, by transcript order (a jsonb object keeps no key order). */
export function keepLastUndos(undo: Record<string, FFSnapshot[]>, transcript: readonly FFChatTurn[]): Record<string, FFSnapshot[]> {
  const ids = transcript.filter((t) => t.role === "assistant" && Object.hasOwn(undo, t.id)).map((t) => t.id);
  return Object.fromEntries(ids.slice(-MAX_UNDO_REPLIES).map((id) => [id, undo[id]]));
}

/** The import's live files — each one's page text read at most once per reply — and the plan as text. */
async function liveFilesContext(scope: FactFinderScope): Promise<WsToolContext> {
  const rows = await listLiveFiles(scope.importId);
  const fileOf = async (fileId: string) => {
    const file = rows.find((f) => f.id === fileId);
    if (!file) throw new Error("That document isn't in this import.");
    return file;
  };
  const pages = new Map<string, Promise<string[]>>();
  return {
    files: rows.map((f) => ({ id: f.id, name: f.originalFilename })),
    documentPages: (fileId) => {
      let read = pages.get(fileId);
      if (!read) {
        read = fileOf(fileId).then((file) => documentPages(scope.importId, file));
        pages.set(fileId, read);
      }
      return read;
    },
    lookAtPages: async (fileId, numbers) => lookAtPages(await fileOf(fileId), numbers),
    planText: async () => planView(await loadBaseCaseRecords(scope.clientId)),
    newId: randomUUID,
  };
}

/**
 * The live staging rows that rows of table `tableId` (every table when absent) show and the plan already has: saved by
 * a round of this import, or linked for certain to a plan record. A link that needs the advisor's click isn't one.
 */
function rowsInPlan(state: FactFinderState, tableId: string | undefined): string[] {
  return state.worksheet.tables
    .filter((t) => tableId === undefined || t.id === tableId)
    .flatMap((t) =>
      t.rows.flatMap((r) => {
        const at = r.ref && locateRow(state, r.ref.rowId);
        if (!at) return [];
        const { id, link } = state.sections[at.sectionId][at.index];
        return rowInPlan(state, r) || (link?.kind === "existing" && link.confirmed) ? [id] : [];
      }),
    );
}

/** `ops` applied to `state`, or null when one of them no longer applies. */
function replay(state: FactFinderState, ops: readonly TurnOp[], ctx: OpContext): FactFinderState | null {
  try {
    return applyTurnOps(state, ops, ctx);
  } catch (err) {
    if (err instanceof FactFinderOpError || err instanceof WorksheetOpError) return null;
    throw err;
  }
}

export async function runWorksheetTurn(args: WorksheetTurnArgs): Promise<WorksheetTurnResult> {
  const { scope, mode } = args;
  const now = args.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const startedAt = now().getTime();
  /** Past this no model call or tool call runs on: the commit needs the rest of the route's time. */
  const stopAt = startedAt + TURN_LIMIT_MS - COMMIT_RESERVE_MS;
  const left = () => stopAt - now().getTime();
  const start = await loadFactFinder(scope);
  if (!start) throw new FactFinderNotFoundError();
  const ctx: WsToolContext = { ...(await liveFilesContext(scope)), ...args.toolContext };
  const noReply = (factFinder: FactFinderState): WorksheetTurnResult => ({ factFinder, turnId: null, toolCallCount: 0, ops: {} });

  // A compose turn's request is the model's message, but no advisor turn is
  // stored; its files are marked composed when it commits.
  let human: string;
  const composed: TurnOp[] = [];
  /** The documents this compose folds in. */
  let composing: string[] = [];
  if (mode === "compose") {
    const request = composeRequest(start, ctx.files);
    if (request.fileIds.length === 0) return noReply(start);
    composing = request.fileIds;
    composed.push({ layer: "ws", op: { op: "markComposed", fileIds: request.fileIds } });
    if (request.message === null) {
      // The worksheet already shows every row they read: nothing for the model to do.
      return noReply(await updateFactFinder(scope, (fresh) => applyTurnOps(fresh, composed, { by: "chat", now: iso(), newId: ctx.newId })));
    }
    human = request.message;
  } else {
    if (!args.message) throw new Error("A message is required.");
    human = redactSsns(args.message).text;
  }
  // A Match names its table to the model by id: the table's title is the AI's, from document text.
  const tableId = args.match?.tableId;
  const named = tableId !== undefined && start.worksheet.tables.some((t) => t.id === tableId);
  const asked = named ? `${human}\n\nThe table: ${tableId}.` : human;

  const model = (args.model ?? (await chatModel("full"))).bindTools(WS_TOOL_DEFS);
  // Links are scored on the working copy as each tool call lands, as the commit scores them: a row the reply fills
  // shows — and set_link offers — the plan record it will link to, not "no candidates".
  const records = await loadBaseCaseRecords(scope.clientId);
  let working = applyLinkScores(start, records);
  const ops: TurnOp[] = [];
  const toolTurns: FFChatTurn[] = [];
  /** Every staging row a propose_plan_update named, first seen first: one review after the commit covers them all. */
  const propose: string[] = [];
  let toolCallCount = 0;
  let finalText = "";
  let outOfTime = false;
  const messages: BaseMessage[] = [
    new SystemMessage(worksheetSystemPrompt(working, ctx.files)),
    ...transcriptToMessages(start.transcript),
    new HumanMessage(asked),
  ];

  // Up to MAX tool calls, then one closing round: once the cap is reached the
  // model is asked once more, and whatever it says ends the reply. Past the
  // time budget no round starts at all — sooner when a review will follow —
  // and a model or tool call still running at `stopAt` is cut off, so the
  // reply commits what it did so far.
  for (let round = 0; round <= MAX_WS_TOOL_CALLS && !outOfTime; round++) {
    const budget = args.match || propose.length > 0 ? WS_REVIEW_TURN_BUDGET_MS : WS_TURN_BUDGET_MS;
    if (now().getTime() >= startedAt + budget) {
      outOfTime = true;
      break;
    }
    messages[0] = new SystemMessage(worksheetSystemPrompt(working, ctx.files)); // tools change the working copy
    let response: AIMessage;
    try {
      response = await model.invoke(messages, { timeout: Math.max(1, left()) });
    } catch (err) {
      if (left() > 0) throw err;
      outOfTime = true;
      break;
    }
    recordMessageUsage(response);
    messages.push(response);
    finalText = typeof response.content === "string" ? response.content : "";
    const calls = response.tool_calls ?? [];
    if (calls.length === 0 || toolCallCount >= MAX_WS_TOOL_CALLS) break;

    for (const call of calls) {
      const callId = call.id ?? `${call.name}-${toolCallCount}`;
      if (toolCallCount >= MAX_WS_TOOL_CALLS) {
        const limit = JSON.stringify({ error: "Tool call limit reached for this turn." });
        messages.push(new ToolMessage({ tool_call_id: callId, content: limit }));
        continue;
      }
      toolCallCount++;
      let summary: string;
      try {
        const outcome = await within(runWorksheetTool(call.name, call.args ?? {}, working, ctx), left());
        working = applyLinkScores(applyTurnOps(working, outcome.ops, { by: "chat", now: iso(), newId: ctx.newId }), records);
        ops.push(...outcome.ops);
        for (const rowId of outcome.propose ?? []) if (!propose.includes(rowId)) propose.push(rowId);
        summary = outcome.summary;
        messages.push(new ToolMessage({ tool_call_id: callId, content: outcome.result }));
      } catch (err) {
        // It can quote document text (a row's label, a file name), so it's fenced like every tool result. It's
        // written for the model (row ids, tool words): the advisor's line says only what didn't go through.
        const msg = redactSsns(err instanceof Error ? err.message : "That tool call failed.").text;
        summary = refusedLine(call.name);
        messages.push(new ToolMessage({ tool_call_id: callId, content: fenceUntrusted(JSON.stringify({ error: msg })) }));
        outOfTime = err instanceof OutOfTime;
      }
      toolTurns.push({ id: ctx.newId(), role: "tool", tool: call.name, summary, at: iso() });
      args.onProgress?.(summary);
      if (outOfTime) break;
    }
  }

  // Rows an advisor reply added from a free-form document fold that document in: it's marked composed, so the compose
  // still owed for it (the screen derives that from what isn't composed) can't add its rows a second time.
  if (mode === "advisor") {
    const cited = new Set(
      ops.flatMap((t) => (t.layer === "ws" && t.op.op === "addRows" ? t.op.rows.flatMap((r) => (r.source ? [r.source.fileId] : [])) : [])),
    );
    const fileIds = [...cited].filter((fileId) => {
      const reading = start.readings[fileId];
      return reading?.status === "done" && reading.reader === "freeform";
    });
    if (fileIds.length > 0) composed.push({ layer: "ws", op: { op: "markComposed", fileIds } });
  }

  const at = iso();
  const reply = outOfTime ? OUT_OF_TIME : finalText.trim() || (toolCallCount >= MAX_WS_TOOL_CALLS ? OUT_OF_STEPS : "Okay.");
  const userTurns: FFChatTurn[] = mode === "advisor" ? [{ id: ctx.newId(), role: "user", text: human, at }] : [];
  const assistantId = ctx.newId();
  const assistant = (text: string): FFChatTurn => ({ id: assistantId, role: "assistant", text, at });

  const opContext: OpContext = { by: "chat", now: at, newId: ctx.newId };
  const replayed = [...ops, ...composed];
  const stagingOps = ops.flatMap((t) => (t.layer === "staging" ? [t.op] : []));
  let committed = false;
  const written = await updateFactFinder(scope, (fresh) => {
    // The ops were made against `start`. If what a staging op touches changed since, or any op
    // no longer applies, none of them does: a value typed meanwhile is never overwritten. Nor
    // does a compose whose documents another compose (a reload's, another tab's) folded in first.
    const composedMeanwhile = composing.some((fileId) => fresh.worksheet.composedFileIds.includes(fileId));
    const rebased = !composedMeanwhile && rebaseOps(stagingOps, start, fresh, opContext).kept.length === stagingOps.length;
    const afterOps = rebased ? replay(fresh, replayed, opContext) : null;
    committed = afterOps !== null;
    // A compose nobody asked for leaves nothing behind: its documents not composed yet stay owed, and the screen composes them again.
    if (!afterOps) {
      return mode === "compose" ? fresh : { ...fresh, transcript: [...fresh.transcript, ...userTurns, assistant(CHANGED_MEANWHILE)] };
    }
    const next = applyLinkScores(afterOps, records);
    // The rows the reply's OPS changed, each as the re-score left it: a row the
    // re-score alone changed stays out of this reply's Undo and highlight, and
    // Undo doesn't refuse a row the re-score just linked. The worksheet is
    // snapshotted as committed, so Undo checks it against what this reply left.
    const snapshots = diffSnapshots(fresh, afterOps).map(
      (snap): FFSnapshot => (snap.kind === "row" ? { ...snap, after: locationOf(next, snap.rowId) } : snap),
    );
    // Composed marks stay out of Undo: undoing a compose reply takes back its tables but keeps its
    // documents composed, so the next compose doesn't redo them. `before` is never `derived` — a
    // derived worksheet is rebuilt on read with no composed marks.
    if (!sameJson(fresh.worksheet.tables, next.worksheet.tables)) {
      const before = { tables: fresh.worksheet.tables, composedFileIds: next.worksheet.composedFileIds };
      snapshots.push({ kind: "worksheet", before, after: next.worksheet });
    }
    const transcript = [...next.transcript, ...userTurns, ...toolTurns, assistant(reply)];
    const undo = snapshots.length > 0 ? keepLastUndos({ ...next.undo, [assistantId]: snapshots }, transcript) : next.undo;
    return { ...next, transcript, undo };
  });

  // A Match proposes its tables' rows already in the plan whatever the model chose, so the review says whether
  // the plan still matches them ("Already up to date") or shows how it drifted.
  if (committed && args.match) {
    for (const rowId of rowsInPlan(written, args.match.tableId)) if (!propose.includes(rowId)) propose.push(rowId);
  }

  const turnId = Object.hasOwn(written.undo, assistantId) ? assistantId : null;
  const result = (factFinder: FactFinderState): WorksheetTurnResult => ({
    factFinder,
    turnId,
    toolCallCount,
    ops: turnId ? countOps(ops.map((t) => t.op)) : {}, // the reply's own ops: a composed mark isn't one
  });
  if (!committed || propose.length === 0) return result(written);
  // Too little time left for the review to end inside the route's limit: the advisor asks again, in a request of its own.
  if (startedAt + TURN_LIMIT_MS - now().getTime() < REVIEW_RESERVE_MS) {
    const noTime: FFChatTurn = { id: ctx.newId(), role: "assistant", text: NO_TIME_TO_PROPOSE, at: iso() };
    return result(await updateFactFinder(scope, (fresh) => ({ ...fresh, transcript: [...fresh.transcript, noTime] })));
  }

  // The change list for the proposed rows, stored by the review. Appending a
  // turn leaves the rows alone, so the stored change list survives it (writeFactFinder).
  const review = args.review ?? reviewFactFinder;
  const outcome = await review(scope, written, { now: now(), runLeftovers, onlyRows: propose });
  const reviewTurn: FFChatTurn = outcome.ok
    ? { id: ctx.newId(), role: "proposal", rowIds: propose, at: iso() }
    : { id: ctx.newId(), role: "assistant", text: outcome.body.error, at: iso() };
  return result(await updateFactFinder(scope, (fresh) => ({ ...fresh, transcript: [...fresh.transcript, reviewTurn] })));
}
