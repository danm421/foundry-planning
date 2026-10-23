"use server";

// Server action behind a Details editor saved inside the Solver. Nothing is
// written: it runs the checks and preparation the scenario `/changes` POST
// runs (and the writer under it), then folds the edits into the Solver's
// unsaved list with `holdEdits`. The caller applies `dropKeys`, then
// `upserts`, and hands the editor `reply`, the body the route would have sent.
//
// Auth follows `change-editor-actions.ts`: `requireClientEditAccess` for the
// owning firm, then `assertScenarioRouteScope` for a scenario source; either
// failing throws. A change refused on its merits answers
// `{ ok: false, status: 400 }`, as the route does.

import { z } from "zod";
import { db } from "@/db";
import { SINGLETON_KIND_TO_FIELD, TARGET_KIND_TO_FIELD } from "@/engine/scenario/applyChanges";
import type { ScenarioEdit } from "@/hooks/use-scenario-writer";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { baseCaseScenarioId } from "@/lib/clients/base-case";
import { CHANGE_REQUEST_SCHEMA } from "@/lib/scenario/change-request-schema";
import {
  assertGiftRecipientAccepted,
  normalizeExpenseLivingItems,
  ScenarioChangeRejectedError,
} from "@/lib/scenario/changes-writer";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  withDefaultBeneficiariesFollowingOwner,
  withDefaultBeneficiariesOnAdd,
} from "@/lib/scenario/retirement-beneficiary-defaults";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";
import { WHOLE_ENTITY_SCHEMAS } from "@/lib/scenario/whole-entity-kinds";
import { summarizeZodIssues } from "@/lib/schemas/common";
import { heldScenarioChanges, holdEdits, type PreparedEdit } from "@/lib/solver/held-changes";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { effectiveMutations, offEntryKeys } from "@/lib/solver/switch-groups";
import type { HeldChangeMutation, SolverMutation, SolverMutationKey } from "@/lib/solver/types";

/** What the `/changes` route would have answered for the last edit. */
export interface HeldEditReply {
  ok: true;
  targetId?: string;
  beneficiaries?: unknown;
}

export type PrepareHeldEditsResult =
  | { ok: true; upserts: HeldChangeMutation[]; dropKeys: SolverMutationKey[]; reply: HeldEditReply }
  | { ok: false; status: 400; error: string };

// A server action is a public endpoint: check the shape before any query.
const INPUT = z.object({
  clientId: z.string().uuid(),
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  offGroups: z.array(z.string()),
  edits: z.array(CHANGE_REQUEST_SCHEMA).min(1),
  saveId: z.string().uuid(),
});

// The schema's held-change arm types `targetKind` wider than `SolverMutation`.
type Input = Omit<z.infer<typeof INPUT>, "mutations"> & { mutations: SolverMutation[] };

interface ScenarioScope {
  clientId: string;
  firmId: string;
  scenarioId: string;
}

/**
 * Hold one editor save's `edits` on the Solver's unsaved list. `mutations` is
 * every entry, on or off; `offGroups` the switched-off groups. Throws without
 * edit access or for a scenario that isn't this client's.
 */
export async function prepareHeldEdits(input: {
  clientId: string;
  source: "base" | string;
  mutations: SolverMutation[];
  offGroups: string[];
  edits: ScenarioEdit[];
  saveId: string;
}): Promise<PrepareHeldEditsResult> {
  const parsed = INPUT.safeParse(input);
  if (!parsed.success) return refused(summarizeZodIssues(parsed.error));
  try {
    return await prepare({ ...parsed.data, mutations: parsed.data.mutations as SolverMutation[] });
  } catch (err) {
    if (err instanceof ScenarioChangeRejectedError) return refused(err.message);
    throw err;
  }
}

async function prepare(input: Input): Promise<PrepareHeldEditsResult> {
  const { clientId, source, mutations, saveId } = input;
  const shaped = input.edits.map(shapeEdit);

  const { firmId } = await requireClientEditAccess(clientId);
  const scope: ScenarioScope = { clientId, firmId, scenarioId: await scenarioIdOf(clientId, source, firmId) };

  const offGroups = new Set(input.offGroups);
  const { effectiveTree: sourceTree } = await loadEffectiveTree(clientId, firmId, source, {});
  // Living items' "current" list is the row as the dialog opened on it: the
  // starting plan plus the switched-on held changes. Only that edit reads it.
  const held = heldScenarioChanges(effectiveMutations(mutations, offGroups, sourceTree));
  const readsItems = shaped.some(
    (e) => e.targetKind === "expense" && e.op === "edit" && "livingItems" in e.desiredFields!,
  );
  const treeWithHeld =
    readsItems && held.length > 0
      ? (await loadEffectiveTree(clientId, firmId, source, {}, held)).effectiveTree
      : sourceTree;

  const edits: PreparedEdit[] = [];
  for (const e of shaped) {
    if (e.op === "add") {
      let entity = e.entity!;
      if (e.targetKind === "account") entity = await withDefaultBeneficiariesOnAdd(scope, entity);
      entity = normalizeExpenseLivingItems(e.targetKind, entity);
      if (e.targetKind === "gift") {
        await assertGiftRecipientAccepted(db, scope.scenarioId, clientId, entity as { id: string });
      }
      edits.push({ ...e, entity });
    } else if (e.op === "edit") {
      let fields = e.desiredFields!;
      if (e.targetKind === "account") fields = await withDefaultBeneficiariesFollowingOwner(scope, e.targetId, fields);
      const current = treeWithHeld.expenses.find((x) => x.id === e.targetId)?.livingItems ?? null;
      edits.push({ ...e, desiredFields: normalizeExpenseLivingItems(e.targetKind, fields, current) });
    } else {
      edits.push(e);
    }
  }

  const { upserts, dropKeys } = holdEdits({
    all: mutations,
    offKeys: offEntryKeys(mutations, offGroups, sourceTree),
    edits,
    source: sourceTree,
    clientId,
    saveId,
  });
  // Every later projection parses the list with this schema; an entry it
  // refuses would fail them all.
  for (const upsert of upserts) {
    const check = SOLVER_MUTATION_SCHEMA.safeParse(upsert);
    if (!check.success) return refused(summarizeZodIssues(check.error));
  }

  const last = edits[edits.length - 1];
  const reply: HeldEditReply =
    last.op === "add" ? { ok: true, targetId: last.targetId, beneficiaries: last.entity?.beneficiaries } : { ok: true };
  return { ok: true, upserts, dropKeys, reply };
}

/**
 * The checks that need no data: the route's whole-entity rules, and the
 * writer's refusal of kinds it can't write (the nested ones; a singleton is
 * edit-only). A whole-entity add keeps the parsed copy, as the writer stores it.
 */
function shapeEdit(body: z.infer<typeof CHANGE_REQUEST_SCHEMA>): PreparedEdit {
  const { targetKind } = body;
  const listed = TARGET_KIND_TO_FIELD[targetKind] != null;
  const whole = WHOLE_ENTITY_SCHEMAS[targetKind];

  if (body.op === "edit") {
    if (whole) reject(`${targetKind} changes are saved whole with op "add"`);
    if (!listed && SINGLETON_KIND_TO_FIELD[targetKind] == null) reject(`Unsupported change: edit ${targetKind}`);
    return { op: "edit", targetKind, targetId: body.targetId, desiredFields: body.desiredFields };
  }
  if (!listed) reject(`Unsupported change: ${body.op} ${targetKind}`);
  if (body.op === "remove") return { op: "remove", targetKind, targetId: body.targetId };

  let entity: Record<string, unknown> = body.entity;
  if (whole) {
    const parsed = whole.safeParse(entity);
    if (!parsed.success) reject(`Invalid ${targetKind}: ${summarizeZodIssues(parsed.error)}`);
    entity = parsed.data;
  }
  return { op: "add", targetKind, targetId: entity.id as string, entity };
}

/** The scenario whose saved rows the checks read: the source, or the base case's own. */
async function scenarioIdOf(clientId: string, source: string, firmId: string): Promise<string> {
  if (source !== "base") {
    const scope = await assertScenarioRouteScope(clientId, source, firmId);
    if (scope.kind === "miss") throw new Error("Scenario not found");
    return source;
  }
  const id = await baseCaseScenarioId(clientId, firmId);
  if (!id) throw new Error("This plan has no base case");
  return id;
}

function reject(message: string): never {
  throw new ScenarioChangeRejectedError(message);
}

function refused(error: string): PrepareHeldEditsResult {
  return { ok: false, status: 400, error };
}
