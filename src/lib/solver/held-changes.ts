// Held changes: Details-editor edits the Solver keeps as unsaved entries.
// Pure and client-safe (no db, no node:).
import type { ClientData } from "@/engine/types";
import type { OpType, ScenarioChange, TargetKind } from "@/engine/scenario/types";
import {
  SINGLETON_KIND_TO_FIELD,
  TARGET_KIND_TO_FIELD,
  applyScenarioChanges,
} from "@/engine/scenario/applyChanges";
import { applyGiftOverlays } from "@/lib/scenario/apply-gift-overlays";
import { buildFieldDiff, editableSingletonFields, priorToValues } from "@/lib/scenario/field-diff";
import { foldChanges } from "@/lib/scenario/fold-changes";
import { mutationsToScenarioChanges } from "./mutations-to-scenario-changes";
import {
  heldChangeKey,
  mutationKey,
  type HeldChangeMutation,
  type SolverMutation,
  type SolverMutationKey,
  type SolverScenarioChangeDraft,
} from "./types";

export function isHeldChange(m: SolverMutation): m is HeldChangeMutation {
  return m.kind === "held-change";
}

/** The held entries as scenario changes. Each payload is a copy: applying a
 *  change can put its payload into the tree, where a removal's cascades rewrite
 *  it (a will's bequests), and the entry itself must stay as held. */
export function heldScenarioChanges(mutations: readonly SolverMutation[]): ScenarioChange[] {
  return mutations.filter(isHeldChange).map((m, i) => ({
    id: "held:" + mutationKey(m),
    scenarioId: "held",
    opType: m.op,
    targetKind: m.targetKind,
    targetId: m.targetId,
    payload: structuredClone(m.payload),
    toggleGroupId: null,
    orderIndex: i,
  }));
}

/** Display only: no resolution context. Gift changes take the loader's gift
 *  overlay (`applyScenarioChangesWithRefs`), as on the server, so a held gift
 *  reads as a gift row and its events, not as its editor draft. */
export function applyHeldChanges(tree: ClientData, mutations: readonly SolverMutation[]): ClientData {
  const held = heldScenarioChanges(mutations);
  if (held.length === 0) return tree;
  const gifts = held.filter((c) => c.targetKind === "gift");
  const rest = held.filter((c) => c.targetKind !== "gift");
  const applied =
    rest.length === 0 ? tree : applyScenarioChanges(tree, foldChanges([], rest), {}, []).effectiveTree;
  const cpi = applied.planSettings.taxInflationRate ?? applied.planSettings.inflationRate ?? 0;
  return applyGiftOverlays(applied, foldChanges([], gifts), cpi);
}

const UPSERT_TARGET = {
  "account-upsert": "account",
  "liability-upsert": "liability",
  "income-upsert": "income",
  "expense-upsert": "expense",
  "savings-rule-upsert": "savings_rule",
  "entity-upsert": "entity",
  "external-beneficiary-upsert": "external_beneficiary",
} as const;

/** Ids of rows this entry creates (not present in the source plan). */
export function idsCreatedBy(m: SolverMutation, source: ClientData): string[] {
  if (m.kind === "held-change") return m.op === "add" ? [m.targetId] : [];
  if (!(m.kind in UPSERT_TARGET)) return [];
  const upsert = m as Extract<SolverMutation, { kind: keyof typeof UPSERT_TARGET }>;
  if (upsert.value == null) return [];
  const field = TARGET_KIND_TO_FIELD[UPSERT_TARGET[upsert.kind]];
  const list: readonly { id: string }[] = (field && (source[field] as { id: string }[] | undefined)) || [];
  return list.some((r) => r.id === upsert.id) ? [] : [upsert.id];
}

/** Entries are never mutated in place (every apply works on copies of their
 *  payloads, see `heldScenarioChanges`), so each one is serialized once. */
const serialized = new WeakMap<SolverMutation, string>();
function textOf(m: SolverMutation): string {
  let text = serialized.get(m);
  if (text === undefined) {
    text = JSON.stringify(m);
    serialized.set(m, text);
  }
  return text;
}

/** Keys of entries whose serialized form mentions any of `ids`. */
export function entriesNaming(
  all: readonly SolverMutation[],
  ids: ReadonlySet<string>,
  except?: SolverMutationKey,
): SolverMutationKey[] {
  const out: SolverMutationKey[] = [];
  for (const m of all) {
    const key = mutationKey(m);
    if (key === except) continue;
    const text = textOf(m);
    for (const id of ids) {
      if (text.includes(id)) {
        out.push(key);
        break;
      }
    }
  }
  return out;
}

/**
 * `seeds`' keys, then every entry naming an id one of them creates, then every
 * entry naming an id one of those creates, and so on: everything that can't
 * stay once the seeds go. Breadth-first, in that order.
 */
export function dependencyClosure(
  all: readonly SolverMutation[],
  seeds: readonly SolverMutation[],
  source: ClientData,
): SolverMutationKey[] {
  const out = new Set(seeds.map(mutationKey));
  const queue = [...seeds];
  const byKey = new Map(all.map((m) => [mutationKey(m), m]));
  for (let i = 0; i < queue.length; i++) {
    const ids = new Set(idsCreatedBy(queue[i], source));
    if (ids.size === 0) continue;
    for (const key of entriesNaming(all, ids)) {
      if (out.has(key)) continue;
      out.add(key);
      queue.push(byKey.get(key) as SolverMutation);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Holding rules: one dialog save's edits → upserts / drops on the unsaved list
// ---------------------------------------------------------------------------

/** One editor change after the scenario route's checks (Task 7). */
export interface PreparedEdit {
  op: OpType;
  targetKind: TargetKind;
  targetId: string;
  /** add: the whole item, normalized. */
  entity?: Record<string, unknown>;
  /** edit: the fields as the dialog sent them, normalized. */
  desiredFields?: Record<string, unknown>;
}

export interface HoldResult {
  /** Set each by key, in this order. */
  upserts: HeldChangeMutation[];
  /** Delete these keys from the list. */
  dropKeys: SolverMutationKey[];
}

interface Item {
  id: string;
  [k: string]: unknown;
}

/** The unsaved list as this call's edits leave it. */
interface WorkingList {
  entries: Map<SolverMutationKey, SolverMutation>;
  /** Keys upserted by this call, in touch order. They carry the new saveId, so they're on. */
  touched: Set<SolverMutationKey>;
  offKeys: ReadonlySet<SolverMutationKey>;
  source: ClientData;
  clientId: string;
  saveId: string;
}

const heldKey = (e: PreparedEdit): SolverMutationKey => heldChangeKey(e.targetKind, e.targetId);

const isTarget = (d: SolverScenarioChangeDraft, e: PreparedEdit) =>
  d.targetKind === e.targetKind && d.targetId === e.targetId;

function isOn(list: WorkingList, key: SolverMutationKey): boolean {
  return list.entries.has(key) && (list.touched.has(key) || !list.offKeys.has(key));
}

function heldChange(list: WorkingList, e: PreparedEdit, op: OpType, payload: unknown): HeldChangeMutation {
  return { kind: "held-change", op, targetKind: e.targetKind, targetId: e.targetId, payload, saveId: list.saveId };
}

function upsert(list: WorkingList, e: PreparedEdit, op: OpType, payload: unknown): HeldChangeMutation {
  const key = heldKey(e);
  const m = heldChange(list, e, op, payload);
  list.entries.set(key, m);
  list.touched.delete(key);
  list.touched.add(key);
  return m;
}

function drop(list: WorkingList, key: SolverMutationKey): void {
  list.entries.delete(key);
  list.touched.delete(key);
}

/** This item's held entry, unless it is switched off (an off entry counts as absent). */
function heldEntry(list: WorkingList, e: PreparedEdit): HeldChangeMutation | undefined {
  const key = heldKey(e);
  const m = list.entries.get(key);
  return m && isHeldChange(m) && isOn(list, key) ? m : undefined;
}

/** Switched-on controls, each with its single-control footprint on every tree in `trees`, unioned. */
function controlFootprints(list: WorkingList, trees: readonly ClientData[]) {
  return [...list.entries]
    .filter(([key, m]) => !isHeldChange(m) && isOn(list, key))
    .map(([key, m]) => ({
      key,
      drafts: trees.flatMap((tree) => mutationsToScenarioChanges(tree, list.clientId, [m])),
    }));
}

/** Drop every switched-on control whose footprint has a draft on this item that `hits`. */
function dropControlsOn(
  list: WorkingList,
  e: PreparedEdit,
  trees: readonly ClientData[],
  hits: (d: SolverScenarioChangeDraft) => boolean = () => true,
): void {
  for (const { key, drafts } of controlFootprints(list, trees)) {
    if (drafts.some((d) => isTarget(d, e) && hits(d))) drop(list, key);
  }
}

/** The switched-on control whose footprint adds this item, with that add's payload. */
function creatingControl(list: WorkingList, e: PreparedEdit) {
  for (const { key, drafts } of controlFootprints(list, [list.source])) {
    const add = drafts.find((d) => d.opType === "add" && isTarget(d, e));
    if (add) return { key, payload: add.payload };
  }
  return undefined;
}

/** The item as the starting plan has it: the singleton, or the list entry. */
function startingItem(source: ClientData, e: PreparedEdit): Item | undefined {
  const singleton = SINGLETON_KIND_TO_FIELD[e.targetKind];
  if (singleton) return source[singleton] as unknown as Item;
  const field = TARGET_KIND_TO_FIELD[e.targetKind];
  const list = field ? (source[field] as unknown as Item[] | undefined) : undefined;
  return list?.find((r) => r.id === e.targetId);
}

/**
 * An add drops every control on its item: the dialog opened on held values plus
 * controls, so it already carries their values (a base gift saves as an add).
 */
function holdAdd(list: WorkingList, e: PreparedEdit): void {
  const added = upsert(list, e, "add", e.entity);
  dropControlsOn(list, e, [list.source, applyHeldChanges(list.source, [added])]);
}

function holdEdit(list: WorkingList, e: PreparedEdit): void {
  const desired = e.desiredFields ?? {};
  const prior = heldEntry(list, e);
  const creator = prior?.op === "add" ? undefined : creatingControl(list, e);
  // The item's add as it stood before this save: a held add, or a control's.
  const startingAdd = prior?.op === "add" ? prior.payload : creator?.payload;

  let result: HeldChangeMutation | undefined;
  if (startingAdd !== undefined) {
    if (creator) drop(list, creator.key);
    result = upsert(list, e, "add", { ...(startingAdd as Record<string, unknown>), ...desired });
  } else {
    const starting = startingItem(list.source, e);
    const merged = { ...priorToValues(prior?.payload), ...desired };
    const diff = buildFieldDiff(editableSingletonFields(e.targetKind, starting, merged), starting);
    if (Object.keys(diff).length === 0) drop(list, heldKey(e));
    else result = upsert(list, e, "edit", diff);
  }

  // A control on a field this save sets is folded in: the dialog opened on its
  // value. Only this save's fields — a control on a field it doesn't send wins.
  // A footprint is read before this save (an added item isn't in the starting
  // plan, so the plan plus that add) and after it, so a control parked at the
  // starting value still shows the field it sets.
  const before =
    startingAdd === undefined
      ? list.source
      : applyHeldChanges(list.source, [heldChange(list, e, "add", startingAdd)]);
  const trees = result ? [before, applyHeldChanges(list.source, [result])] : [before];
  dropControlsOn(
    list,
    e,
    trees,
    (d) =>
      d.opType === "edit" &&
      Object.keys(d.payload as Record<string, unknown>).some((f) => Object.hasOwn(desired, f)),
  );
}

function holdRemove(list: WorkingList, e: PreparedEdit): void {
  const prior = heldEntry(list, e);
  // A gift's add is a base gift's edit as often as a new gift, so a gift always
  // takes the remove marker (as `foldChanges` and the scenario writer do).
  const creatorKey =
    e.targetKind === "gift"
      ? undefined
      : prior?.op === "add"
        ? heldKey(e)
        : creatingControl(list, e)?.key;

  if (creatorKey) {
    const all = [...list.entries.values()];
    const creator = list.entries.get(creatorKey) as SolverMutation;
    for (const key of dependencyClosure(all, [creator], list.source)) drop(list, key);
    return;
  }

  upsert(list, e, "remove", null);
  dropControlsOn(list, e, [list.source]);
}

/**
 * Turn one dialog save's edits into upserts and drops on the Solver's unsaved
 * list. One held entry per item; each edit sees the previous edits' result.
 * The caller applies `dropKeys`, then `upserts`.
 */
export function holdEdits(args: {
  /** Every entry, on or off. */
  all: readonly SolverMutation[];
  /** Entries that are effectively off. */
  offKeys: ReadonlySet<SolverMutationKey>;
  edits: readonly PreparedEdit[];
  /** The starting plan: no held entries, no controls. */
  source: ClientData;
  clientId: string;
  saveId: string;
}): HoldResult {
  const list: WorkingList = {
    entries: new Map(args.all.map((m) => [mutationKey(m), m])),
    touched: new Set(),
    offKeys: args.offKeys,
    source: args.source,
    clientId: args.clientId,
    saveId: args.saveId,
  };
  for (const e of args.edits) {
    if (e.op === "add") holdAdd(list, e);
    else if (e.op === "edit") holdEdit(list, e);
    else holdRemove(list, e);
  }
  return {
    upserts: [...list.touched].map((key) => list.entries.get(key) as HeldChangeMutation),
    dropKeys: args.all.map(mutationKey).filter((key) => !list.entries.has(key)),
  };
}
