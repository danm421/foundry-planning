// A presentation page may need "the base plan, but with one thing changed" — a
// variant that exists nowhere in the database and that no advisor had to build
// by hand. This module turns such a request into a built bundle: apply solver
// mutations to an already-loaded tree, re-run the projection.
//
// Pure and framework-free. `deps` (applyMutations + runProjection) is injected
// by the caller rather than defaulted here, so this module never value-imports
// the engine or the solver — it is reached from "use client" launcher
// components via the presentation registry, and a value import of the engine
// would drag the whole projection into the browser bundle. The server-only
// export route constructs the real deps and passes them in.

import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";

/** The already-loaded bundle a variant is derived FROM. */
export interface DerivedSource {
  clientData: ClientData;
  projection: ProjectionResult;
}

/** Mutations that can only be named once the source is known — e.g. a
 *  per-account mutation whose account ids live in the tree, or one sized
 *  against what the source plan actually does. `requiredDerivedRefs` sees only
 *  page options, so anything source-scoped MUST use this form.
 *
 *  It gets the source's PROJECTION as well as its tree: a rung expressed as
 *  "three points more than the client saves today" cannot be sized off the
 *  tree alone, because what the plan saves is what the engine contributed
 *  after the IRS deferral cap, not the sum of the rules' own percents. */
export type MutationFactory = (source: DerivedSource) => SolverMutation[];

export interface DerivedRefRequest {
  /** Page-local key. Namespaced by `derivedKey` before it reaches bundlesByRef. */
  key: string;
  /** Raw ref to derive FROM: "base" | "<scenarioId>" | "snap:<id>". */
  from: string;
  /** Human label for this variant, printed wherever the page names it. */
  label: string;
  mutations: SolverMutation[] | MutationFactory;
}

export interface DerivedBundle {
  clientData: ClientData;
  projection: ProjectionResult;
  scenarioLabel: string;
}

export interface DerivedDeps {
  applyMutations: (data: ClientData, mutations: SolverMutation[]) => ClientData;
  runProjection: (data: ClientData) => ProjectionResult;
}

/**
 * Namespaced bundle key. Page-scoped on purpose: two pages that each want a
 * "+3pp" variant must not share a cache slot, because their mutations may
 * differ. The cost of the occasional duplicate projection is ~20ms; the cost of
 * a silent collision is one page rendering another page's numbers.
 */
export function derivedKey(pageId: string, key: string): string {
  return `derived:${pageId}:${key}`;
}

/**
 * Key for ONE DECK ENTRY's variant in the export's global bundle store.
 *
 * A deck may legitimately contain the same page twice with different options —
 * `addPage` in the launcher appends without deduping, and `document.tsx` keys
 * its fragments `pageId + idx` for exactly that reason. Two entries of one page
 * ask for the same variant `key`, so a store keyed by page id alone would have
 * the second entry overwrite the first and both sheets would print the second
 * entry's numbers under their own headings.
 *
 * Pages never see this form. The document re-keys each entry's slice back to
 * `derivedKey(pageId, key)` before handing it to the view model, which knows
 * its own page id but has no business knowing its position in the deck.
 */
export function entryDerivedKey(entryIndex: number, pageId: string, key: string): string {
  return `${derivedKey(pageId, key)}@${entryIndex}`;
}

export function buildDerivedBundle(
  source: DerivedSource,
  req: DerivedRefRequest,
  deps: DerivedDeps,
): DerivedBundle {
  const mutations = typeof req.mutations === "function"
    ? req.mutations(source)
    : req.mutations;
  const clientData = deps.applyMutations(source.clientData, mutations);
  return {
    clientData,
    projection: deps.runProjection(clientData),
    scenarioLabel: req.label,
  };
}
