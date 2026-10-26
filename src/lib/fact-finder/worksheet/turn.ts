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
import { sameJson } from "../state";
import type { FactFinderState, FFChatTurn, FFSnapshot } from "../types";
import { composeRequest } from "./compose";
import { lookAtPages } from "./look";
import { WorksheetOpError } from "./ops";
import { documentPages } from "./page-text";
import { planView } from "./plan-view";
import { worksheetSystemPrompt } from "./prompt";
import { WS_TOOL_DEFS, runWorksheetTool, type WsToolContext } from "./tools";
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
/** No new model round starts after this long; the route's maxDuration is 300 s. */
export const WS_TURN_BUDGET_MS = 240_000;
/** Replies that keep their Undo; older ones lose it. */
const MAX_UNDO_REPLIES = 10;
const OUT_OF_STEPS = "I ran out of steps for one reply — ask me to carry on.";
const OUT_OF_TIME = "I ran out of time for one reply — ask me to carry on.";
const CHANGED_MEANWHILE = "The worksheet changed while I was working on that — ask me again.";

/** `chatModel()`'s shape, narrow enough for a test double. */
export interface TurnModel {
  bindTools(defs: unknown[]): { invoke(messages: BaseMessage[]): Promise<AIMessage> };
}

export interface WorksheetTurnArgs {
  scope: FactFinderScope;
  /** "compose": fold the documents read since the last compose into the worksheet. */
  mode: "advisor" | "compose";
  /** The advisor's words; required for "advisor". */
  message?: string;
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
  const deadline = now().getTime() + WS_TURN_BUDGET_MS;
  const start = await loadFactFinder(scope);
  if (!start) throw new FactFinderNotFoundError();
  const ctx: WsToolContext = { ...(await liveFilesContext(scope)), ...args.toolContext };
  const noReply = (factFinder: FactFinderState): WorksheetTurnResult => ({ factFinder, turnId: null, toolCallCount: 0, ops: {} });

  // A compose turn's request is the model's message, but no advisor turn is
  // stored; its files are marked composed when it commits.
  let human: string;
  const composed: TurnOp[] = [];
  if (mode === "compose") {
    const request = composeRequest(start, ctx.files);
    if (request.fileIds.length === 0) return noReply(start);
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

  const model = (args.model ?? (await chatModel("full"))).bindTools(WS_TOOL_DEFS);
  let working = start;
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
    new HumanMessage(human),
  ];

  // Up to MAX tool calls, then one closing round: once the cap is reached the
  // model is asked once more, and whatever it says ends the reply. Past the
  // time budget no round starts at all.
  for (let round = 0; round <= MAX_WS_TOOL_CALLS; round++) {
    if (now().getTime() >= deadline) {
      outOfTime = true;
      break;
    }
    messages[0] = new SystemMessage(worksheetSystemPrompt(working, ctx.files)); // tools change the working copy
    const response = await model.invoke(messages);
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
        const outcome = await runWorksheetTool(call.name, call.args ?? {}, working, ctx);
        working = applyTurnOps(working, outcome.ops, { by: "chat", now: iso(), newId: ctx.newId });
        ops.push(...outcome.ops);
        for (const rowId of outcome.propose ?? []) if (!propose.includes(rowId)) propose.push(rowId);
        summary = outcome.summary;
        messages.push(new ToolMessage({ tool_call_id: callId, content: outcome.result }));
      } catch (err) {
        // It can quote document text (a row's label, a file name), so it's fenced like every tool result.
        const msg = redactSsns(err instanceof Error ? err.message : "That tool call failed.").text;
        summary = `Couldn't do that: ${msg}`;
        messages.push(new ToolMessage({ tool_call_id: callId, content: fenceUntrusted(JSON.stringify({ error: msg })) }));
      }
      toolTurns.push({ id: ctx.newId(), role: "tool", tool: call.name, summary, at: iso() });
      args.onProgress?.(summary);
    }
  }

  const at = iso();
  const reply = outOfTime ? OUT_OF_TIME : finalText.trim() || (toolCallCount >= MAX_WS_TOOL_CALLS ? OUT_OF_STEPS : "Okay.");
  const userTurns: FFChatTurn[] = mode === "advisor" ? [{ id: ctx.newId(), role: "user", text: human, at }] : [];
  const assistantId = ctx.newId();
  const assistant = (text: string): FFChatTurn => ({ id: assistantId, role: "assistant", text, at });
  const records = await loadBaseCaseRecords(scope.clientId);

  const opContext: OpContext = { by: "chat", now: at, newId: ctx.newId };
  const replayed = [...ops, ...composed];
  const stagingOps = ops.flatMap((t) => (t.layer === "staging" ? [t.op] : []));
  let committed = false;
  const written = await updateFactFinder(scope, (fresh) => {
    // The ops were made against `start`. If what a staging op touches changed since, or any op
    // no longer applies, none of them does: a value typed meanwhile is never overwritten.
    const afterOps = rebaseOps(stagingOps, start, fresh, opContext).kept.length === stagingOps.length ? replay(fresh, replayed, opContext) : null;
    committed = afterOps !== null;
    if (!afterOps) return { ...fresh, transcript: [...fresh.transcript, ...userTurns, assistant(CHANGED_MEANWHILE)] };
    const next = applyLinkScores(afterOps, records);
    // The rows the reply's OPS changed, each as the re-score left it: a row the
    // re-score alone changed stays out of this reply's Undo and highlight, and
    // Undo doesn't refuse a row the re-score just linked. The worksheet is
    // snapshotted as committed, so Undo checks it against what this reply left.
    const snapshots = diffSnapshots(fresh, afterOps).map(
      (snap): FFSnapshot => (snap.kind === "row" ? { ...snap, after: locationOf(next, snap.rowId) } : snap),
    );
    if (!sameJson(fresh.worksheet, next.worksheet)) snapshots.push({ kind: "worksheet", before: fresh.worksheet, after: next.worksheet });
    const transcript = [...next.transcript, ...userTurns, ...toolTurns, assistant(reply)];
    const undo = snapshots.length > 0 ? keepLastUndos({ ...next.undo, [assistantId]: snapshots }, transcript) : next.undo;
    return { ...next, transcript, undo };
  });

  const turnId = Object.hasOwn(written.undo, assistantId) ? assistantId : null;
  const result = (factFinder: FactFinderState): WorksheetTurnResult => ({
    factFinder,
    turnId,
    toolCallCount,
    ops: turnId ? countOps(replayed.map((t) => t.op)) : {},
  });
  if (!committed || propose.length === 0) return result(written);

  // The change list for the proposed rows, stored by the review. Appending a
  // turn leaves the rows alone, so the stored change list survives it (writeFactFinder).
  const review = args.review ?? reviewFactFinder;
  const outcome = await review(scope, written, { now: now(), runLeftovers, onlyRows: propose });
  const reviewTurn: FFChatTurn = outcome.ok
    ? { id: ctx.newId(), role: "proposal", rowIds: propose, at: iso() }
    : { id: ctx.newId(), role: "assistant", text: outcome.body.error, at: iso() };
  return result(await updateFactFinder(scope, (fresh) => ({ ...fresh, transcript: [...fresh.transcript, reviewTurn] })));
}
