// src/lib/fact-finder/save/types.ts
/**
 * The save writer contract (Plan 4, D4). One SaveWriter per change-set target
 * turns a change line's Details request body into its write core's call on the
 * save's transaction, plus the few writes the Details routes don't make.
 *
 * Type-only imports: the browser's save plan (save/plan.ts) imports this
 * file's types, and nothing here may pull a server module into its bundle.
 */
import type { EntityWriteResult } from "@/lib/clients/entity-write-result";
import type { AfterCommit, Tx } from "@/lib/db-tx";
import type { ResolvedHoldingsMap } from "@/lib/imports/commit/types";
import type { ChangeLine, PlacedValue } from "../change-set";

export interface SaveContext {
  tx: Tx;
  clientId: string;
  firmId: string;
  actorId: string;
  /** The advisor an ops operator is acting as (`actorId` is then the operator). */
  actingAsAdvisor?: string;
  afterCommit: AfterCommit;
  /** Tickers priced before the transaction (Task 2's resolveSaveHoldings). */
  holdings: ResolvedHoldingsMap;
}

/** A line the save writes, with the advisor's ticks applied (Task 15). */
export interface PlannedLine {
  line: ChangeLine;
  values: Record<string, PlacedValue>;
}

/** A line the advisor's ticks leave out, and why. */
export interface LeftOutLine {
  lineId: string;
  rowId: string;
  label: string;
  reason: string;
}

export interface SaveInput {
  line: ChangeLine;
  /** lineValues(line, ticks): refs unresolved. */
  values: Record<string, PlacedValue>;
  /** payloadFor(line.target, values, resolve): the Details request body. */
  body: Record<string, unknown>;
  /** Update: the record. */
  recordId: string | null;
  /** line.parent resolved. */
  parentId: string | null;
}

export interface SaveWriter {
  /** Writes a Create line; returns the id other lines' refs to it resolve to (a set's: its parent's). */
  create(ctx: SaveContext, input: SaveInput): Promise<string>;
  update(ctx: SaveContext, input: SaveInput): Promise<void>;
}

/** A line the write path refused; the save rolls back and names the line. */
export class SaveLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveLineError";
  }
}

/**
 * What a writer's core call passes: the save's client and actor, its transaction and after-commit queue —
 * and, while an ops operator saves, the advisor they act as, on the cores' extra audit metadata
 * (`crossFirmMeta`, which every core that audits spreads into its row).
 */
export function coreArgs(ctx: SaveContext) {
  const core = { clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, tx: ctx.tx, afterCommit: ctx.afterCommit };
  return ctx.actingAsAdvisor ? { ...core, crossFirmMeta: { actingAsAdvisor: ctx.actingAsAdvisor } } : core;
}

/** An Update line's record (the save resolves it before it calls a writer), or a SaveLineError with the writer's own `message`. */
export function recordIdOf(input: SaveInput, message: string): string {
  if (!input.recordId) throw new SaveLineError(message);
  return input.recordId;
}

/** A core's result, or a SaveLineError with its message. */
export function unwrap<T>(result: EntityWriteResult<T>): { data: T; resourceId: string } {
  if (!result.ok) throw new SaveLineError(reasonOf(result));
  return { data: result.data, resourceId: result.resourceId };
}

/** The route body's first issue ("benefitAmount: Must be more than 0") when it has one — "Invalid body" says nothing — else the core's error. */
function reasonOf(result: { error: string; body?: Record<string, unknown> }): string {
  const issues = result.body?.issues;
  const first = (Array.isArray(issues) ? issues[0] : undefined) as { path?: unknown; message?: unknown } | undefined;
  if (typeof first?.message !== "string") return result.error;
  const path = Array.isArray(first.path) ? first.path.join(".") : typeof first.path === "string" ? first.path : "";
  return path ? `${path}: ${first.message}` : first.message;
}
