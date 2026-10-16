// src/lib/fact-finder/save/save.ts
/**
 * The save (Plan 4, D5–D11): the reviewed change list, with the advisor's
 * ticks, written to the plan in ONE repeatable-read transaction and the import
 * closed — or nothing written at all. Before the transaction: the ticks plan
 * the save (the lines written, their order, what they leave out), each written
 * line is re-checked with those ticks, and tickers are priced. Inside it: the
 * import locked and checked again, the record book reloaded and compared with
 * what the review relied on, every line through its writer in order — its
 * references resolved to records the save already wrote, and to the household
 * as the lines before it left it — then the import closed and the save audited.
 * Work the writers queue runs once the transaction has committed.
 *
 * SERVER-SIDE ONLY.
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { familyMembers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { snapshotActorName } from "@/lib/audit/actor-name";
import { afterCommitQueue, type DbOrTx, type Tx } from "@/lib/db-tx";
import type { ResolvedHoldingsMap } from "@/lib/imports/commit/types";
import { loadImportMilestones, type ImportMilestones } from "@/lib/imports/import-milestones";
import { coerceYearRef, resolveMilestone, YEAR_REF_LABELS } from "@/lib/milestones";
import { safeErrorFields } from "@/lib/redaction/secrets";
import {
  SAVE_CLOSED_MESSAGE, SAVE_FAILED_MESSAGE, SAVE_HOUSEHOLD_MESSAGE, SAVE_NOTHING_MESSAGE, SAVE_RACE_MESSAGE, SAVE_READING_MESSAGE, SAVE_STALE_MESSAGE,
} from "../api-types";
import { countLines, type ChangeSet, type TargetKind } from "../change-set";
import { closeFactFinder, loadFactFinder, lockFactFinder, type FactFinderScope } from "../persist";
import { payloadFor, type Resolve } from "../placement/payload";
import { validateLines } from "../placement/validate";
import { filesReading } from "../reading-status";
import { loadRecordBook } from "../records/book";
import { resolveBaseCaseScenarioId } from "../records/load";
import type { FactFinderState, FFClosed } from "../types";
import { planSave } from "./plan";
import { staleProblem } from "./stale";
import { SaveLineError, type LeftOutLine, type PlannedLine, type SaveContext, type SaveInput, type SaveWriter } from "./types";
import { SAVE_WRITERS } from "./writers";
import { resolveSaveHoldings } from "./writers/accounts";

export interface SaveRequest {
  scope: FactFinderScope;
  actorId: string;
  changeSetVersion: number;
  /** As the request sent them: planSave checks them against the change list. */
  ticks: unknown;
}

export type SaveOutcome =
  | { ok: true; factFinder: FactFinderState }
  | { ok: false; status: 409 | 422 | 500; error: string; lineId?: string; factFinder?: FactFinderState };

export interface SaveDeps {
  writers: Readonly<Record<TargetKind, SaveWriter>>;
  resolveHoldings: (planned: readonly PlannedLine[]) => Promise<ResolvedHoldingsMap>;
  now: () => Date;
}

type Refused = Extract<SaveOutcome, { ok: false }>;

function refuse(status: Refused["status"], error: string, extra: Pick<Refused, "lineId" | "factFinder"> = {}): Refused {
  return { ok: false, status, error, ...extra };
}

/** Thrown inside the transaction to roll it back; the save answers with its outcome. */
class Refusal extends Error {
  constructor(readonly outcome: Refused) {
    super(outcome.error);
  }
}

/** The fact finder and the change list the advisor ticked, while it can still be saved: not saved already, not reviewed again since. */
function reviewed(state: FactFinderState | null, changeSetVersion: number): { ok: true; state: FactFinderState; changeSet: ChangeSet } | Refused {
  if (!state) return refuse(409, SAVE_STALE_MESSAGE);
  if (state.closed) return refuse(409, SAVE_CLOSED_MESSAGE, { factFinder: state });
  if (!state.changeSet || state.changeSet.builtAtVersion !== changeSetVersion) return refuse(409, SAVE_STALE_MESSAGE, { factFinder: state });
  return { ok: true, state, changeSet: state.changeSet };
}

/** The client's and co-client's family members — the record book's `people`, and who a person ref names. */
async function peopleOf(handle: DbOrTx, clientId: string): Promise<{ client: string | null; spouse: string | null }> {
  const rows = await handle
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, clientId), inArray(familyMembers.role, ["client", "spouse"])));
  return { client: rows.find((r) => r.role === "client")?.id ?? null, spouse: rows.find((r) => r.role === "spouse")?.id ?? null };
}

/** The household as the save's transaction has it. */
interface Household {
  people: { client: string | null; spouse: string | null };
  milestones: ImportMilestones | null;
}

async function householdOn(tx: Tx, scope: FactFinderScope, scenarioId: string | null): Promise<Household> {
  return {
    people: await peopleOf(tx, scope.clientId),
    milestones: await loadImportMilestones(scope.clientId, scope.firmId, scenarioId, tx),
  };
}

/**
 * D7: a record ref is its id (the stale check has just found it on the plan); a line ref, the id its line's
 * writer returned; a person, their family member; a milestone, its year. A ref that can't resolve refuses the
 * line — never a guess.
 */
function resolverOf(ids: ReadonlyMap<string, string>, labels: ReadonlyMap<string, string>, household: Household): Resolve {
  return {
    id(ref) {
      if (ref.ref === "record") return ref.id;
      if (ref.ref === "line") {
        const id = ids.get(ref.lineId);
        if (id === undefined) throw new SaveLineError(`Needs “${labels.get(ref.lineId) ?? "another row"}”, which isn't saved before it.`);
        return id;
      }
      const id = household.people[ref.role];
      if (id === null) throw new SaveLineError(`Needs the ${ref.role === "spouse" ? "co-client" : "client"}, who isn't on the plan.`);
      return id;
    },
    year(yearRef, position) {
      const ref = coerceYearRef(yearRef);
      const year = ref && household.milestones ? resolveMilestone(ref, household.milestones.milestones, position) : undefined;
      if (year === undefined) {
        throw new SaveLineError(`Can't tell which year ${ref ? YEAR_REF_LABELS[ref] : yearRef} is — check the dates of birth and retirement ages on the Household page.`);
      }
      return year;
    },
  };
}

/** Each written line through the Details write path's checks with the advisor's ticks — validateLines checks every field it's given, so it gets the ticked ones. */
function firstInvalid(lines: readonly PlannedLine[]): Refused | null {
  const checked = validateLines(lines.map(({ line }) => ({ ...line, fields: line.fields.filter((f) => f.ticked) })), () => undefined);
  const line = checked.find((l) => l.blocked);
  return line?.blocked ? refuse(422, `${line.label}: ${line.blocked.reason}`, { lineId: line.id }) : null;
}

/** One line through its writer: a Create's new id, an Update's record. A line the write path refuses refuses the save, naming it. */
async function saveLine(writer: SaveWriter, ctx: SaveContext, { line, values }: PlannedLine, resolve: Resolve): Promise<string> {
  try {
    const input: SaveInput = {
      line,
      values,
      body: payloadFor(line.target, values, resolve),
      recordId: line.recordId,
      parentId: line.parent ? resolve.id(line.parent) : null,
    };
    if (line.action === "create") return await writer.create(ctx, input);
    await writer.update(ctx, input);
    // An Update always has its record — the stale check has just found it on the plan.
    return line.recordId!;
  } catch (err) {
    if (err instanceof SaveLineError) throw new Refusal(refuse(422, `${line.label}: ${err.message}`, { lineId: line.id }));
    throw err;
  }
}

/** What doesn't reach the plan, in change-list order: the lines the review blocked, and the lines the ticks leave out. */
function notSaved(changeSet: ChangeSet, leftOut: readonly LeftOutLine[]): LeftOutLine[] {
  const byTicks = new Map(leftOut.map((l) => [l.lineId, l]));
  return changeSet.lines.flatMap((line): LeftOutLine[] => {
    if (line.blocked) return [{ lineId: line.id, rowId: line.rowId, label: line.label, reason: line.blocked.reason }];
    const out = byTicks.get(line.id);
    return out ? [out] : [];
  });
}

/**
 * Postgres aborted the save over another transaction's write: a serialization failure (a row the save writes
 * changed after its snapshot) or a deadlock. Drizzle wraps driver errors — the code is on `cause`.
 */
function isConflict(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return [e?.code, e?.cause?.code].some((code) => code === "40001" || code === "40P01");
}

/**
 * Saves the change list the advisor reviewed at `changeSetVersion`, with their ticks, to the client's base case.
 * 409: saved already, reviewed again since, a document still reading, ticks that don't match or leave nothing to
 * save, the household or a record changed since the review or while saving; 422: a line the write path refuses
 * (`lineId`); 500: anything else (`lineId` when a line was being written). Every refusal writes nothing.
 */
export async function saveChangeSet(request: SaveRequest, deps: Partial<SaveDeps> = {}): Promise<SaveOutcome> {
  const { writers, resolveHoldings, now } = { writers: SAVE_WRITERS, resolveHoldings: resolveSaveHoldings, now: () => new Date(), ...deps };
  const { scope, actorId, changeSetVersion } = request;
  const started = Date.now();
  const at = now();

  const open = reviewed(await loadFactFinder(scope), changeSetVersion);
  if (!open.ok) return open;
  const { changeSet } = open;
  const scenarioId = await resolveBaseCaseScenarioId(scope.clientId);
  // The co-client as the review saw them; a list stored before the review recorded that, as the plan has them now.
  const hasCoClient = changeSet.hasCoClient ?? (await peopleOf(db, scope.clientId)).spouse !== null;
  const plan = planSave(changeSet, request.ticks, { hasCoClient });
  if (!plan.ok) return refuse(409, plan.error);
  if (plan.lines.length === 0) return refuse(409, SAVE_NOTHING_MESSAGE);
  const invalid = firstInvalid(plan.lines);
  if (invalid) return invalid;
  const holdings = await resolveHoldings(plan.lines);
  // Every audit row in the transaction names the actor: one Clerk lookup now, cached, not one per row while it holds its locks.
  await snapshotActorName(actorId);

  const queue = afterCommitQueue();
  const labels = new Map(changeSet.lines.map((l) => [l.id, l.label]));
  const lines = plan.lines.map((p) => p.line);
  let writing: string | undefined;
  try {
    const factFinder = await db.transaction(
      async (tx) => {
        // Another save, or an edit, may have landed since the read above.
        const locked = reviewed(await lockFactFinder(tx, scope), changeSetVersion);
        if (!locked.ok) throw new Refusal(locked);
        // A document being read lands its rows after the save — on a closed import, which refuses them.
        if (filesReading(locked.state, at).length > 0) throw new Refusal(refuse(409, SAVE_READING_MESSAGE));
        const book = await loadRecordBook(scope.clientId, scope.firmId, scenarioId, tx);
        // The plan kept or left out the lines naming the co-client by the household the review saw (an older list: as it was before the transaction).
        if ((book.people.spouse !== null) !== hasCoClient) {
          throw new Refusal(refuse(409, changeSet.hasCoClient === undefined ? SAVE_RACE_MESSAGE : SAVE_HOUSEHOLD_MESSAGE));
        }
        const stale = staleProblem(lines, locked.state, book, at);
        if (stale) throw new Refusal(refuse(409, stale.message, { lineId: stale.lineId }));

        const ctx: SaveContext = { tx, clientId: scope.clientId, firmId: scope.firmId, actorId, afterCommit: queue.afterCommit, holdings };
        const ids = new Map<string, string>();
        const saved: FFClosed["saved"] = [];
        let household: Household | null = null;
        for (const planned of plan.lines) {
          const { line } = planned;
          writing = line.id;
          household ??= await householdOn(tx, scope, scenarioId);
          const recordId = await saveLine(writers[line.target], ctx, planned, resolverOf(ids, labels, household));
          if (line.action === "create") ids.set(line.id, recordId);
          saved.push({ lineId: line.id, rowId: line.rowId, target: line.target, recordId, label: line.label });
          // A household line can add the co-client or move a milestone: the next line reads the household again.
          if (line.target === "client_household") household = null;
        }
        writing = undefined;

        const leftOut = notSaved(changeSet, plan.leftOut);
        const closed = await closeFactFinder(tx, scope, locked.state.version, { at: at.toISOString(), by: actorId, saved, leftOut });
        if (!closed) throw new Refusal(refuse(409, SAVE_RACE_MESSAGE));
        const targets: Partial<Record<TargetKind, number>> = {};
        for (const s of saved) targets[s.target] = (targets[s.target] ?? 0) + 1;
        const { creates, updates } = countLines(lines);
        await recordAudit({
          action: "import.fact_finder_saved",
          resourceType: "client_import",
          resourceId: scope.importId,
          clientId: scope.clientId,
          firmId: scope.firmId,
          actorId,
          metadata: {
            saved: saved.length, leftOut: leftOut.length, creates, updates, targets, ms: Date.now() - started,
            // Each line by its record: the writers' own follow-up writes (positions, employer, address…) have no audit row.
            records: saved.map(({ lineId, target, recordId }) => ({ lineId, target, recordId })),
          },
          tx,
        });
        return closed;
      },
      { isolationLevel: "repeatable read" },
    );
    await queue.flush();
    console.log(`[fact-finder-save] import ${scope.importId}: ${lines.length} lines in ${Date.now() - started} ms`);
    return { ok: true, factFinder };
  } catch (err) {
    if (err instanceof Refusal) return err.outcome;
    if (isConflict(err)) {
      // Something the save read changed under it: another save closed the import, an edit moved it on, or a Details edit hit (or deadlocked on) a record a line writes.
      const after = reviewed(await loadFactFinder(scope), changeSetVersion);
      return after.ok ? refuse(409, SAVE_RACE_MESSAGE) : after;
    }
    console.error(`[fact-finder-save] import ${scope.importId}: the save failed${writing ? ` at ${writing}` : ""}:`, safeErrorFields(err));
    return refuse(500, SAVE_FAILED_MESSAGE, writing ? { lineId: writing } : {});
  }
}
