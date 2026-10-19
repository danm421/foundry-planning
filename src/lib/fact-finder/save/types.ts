// src/lib/fact-finder/save/types.ts
/**
 * The save writer contract (Plan 4, D4). One SaveWriter per change-set target
 * turns a change line's Details request body into its write core's call on the
 * save's transaction, plus the few writes the Details routes don't make.
 *
 * Type-only imports: the browser's save plan (save/plan.ts) imports this
 * file's types, and nothing here may pull a server module into its bundle.
 */
import type { Principal } from "@/lib/clients/authz";
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
  /** Whose access every core checks when the save has no Clerk session (the Claude connector's); else the session's. */
  principal?: Principal;
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
 * What a writer's core call passes: the save's client and actor, its transaction and after-commit queue,
 * the principal it runs on when it has one — and, while an ops operator saves, the advisor they act as, on
 * the cores' extra audit metadata (`crossFirmMeta`, which every core that audits spreads into its row).
 */
export function coreArgs(ctx: SaveContext) {
  const core = {
    clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, tx: ctx.tx, afterCommit: ctx.afterCommit,
    ...(ctx.principal ? { principal: ctx.principal } : {}),
  };
  return ctx.actingAsAdvisor ? { ...core, crossFirmMeta: { actingAsAdvisor: ctx.actingAsAdvisor } } : core;
}

/** An Update line's record (the save resolves it before it calls a writer), or a SaveLineError with the writer's own `message`. */
export function recordIdOf(input: SaveInput, message: string): string {
  if (!input.recordId) throw new SaveLineError(message);
  return input.recordId;
}

/** A core's result, or a SaveLineError with its message in plain words. */
export function unwrap<T>(result: EntityWriteResult<T>): { data: T; resourceId: string } {
  if (!result.ok) throw new SaveLineError(plainReason(reasonOf(result)));
  return { data: result.data, resourceId: result.resourceId };
}

/** db-scoping's "<Kind> <id> not owned by this client", by the kind's name as the advisor knows it. */
const NOT_OWNED = /^(Account|Income|Liability|Entity|Family member|External beneficiary) \S+ not owned by this client$/;
const OWNED_NOUN: Record<string, string> = {
  Account: "An account", Income: "An income", Liability: "A debt", Entity: "A trust or business",
  "Family member": "A family member", "External beneficiary": "A charity or beneficiary",
};
/** db-scoping's "Account <id> is not a business account" (or real estate). */
const NOT_KIND = /^Account \S+ is not a (business|real estate) account$/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * The refusals a core can still give past the save's stale check — a record gone or another client's, a will
 * already on file — in the advisor's words: never an id or a column name. Anything else is the core's own.
 */
function plainReason(error: string): string {
  const notOwned = NOT_OWNED.exec(error);
  if (notOwned) return `${OWNED_NOUN[notOwned[1]]} this line names isn't on the plan — review again.`;
  const notKind = NOT_KIND.exec(error);
  if (notKind) return `The ${notKind[1] === "business" ? "business" : "property"} this line names isn't a ${notKind[1]} account on the plan — review again.`;
  if (error.startsWith("A will already exists for grantor=")) return "The plan already has this person's will — review again.";
  if (UUID.test(error)) return "A record this line names doesn't match the plan any more — review again.";
  return error;
}

/** The route body's first issue ("benefitAmount: Must be more than 0") when it has one — "Invalid body" says nothing — else the core's error. */
function reasonOf(result: { error: string; body?: Record<string, unknown> }): string {
  const issues = result.body?.issues;
  const first = (Array.isArray(issues) ? issues[0] : undefined) as { path?: unknown; message?: unknown } | undefined;
  if (typeof first?.message !== "string") return result.error;
  const path = Array.isArray(first.path) ? first.path.join(".") : typeof first.path === "string" ? first.path : "";
  return path ? `${path}: ${first.message}` : first.message;
}
