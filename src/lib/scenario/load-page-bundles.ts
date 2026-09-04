// One place that turns a planned set of scenario refs into built
// `PageScenarioBundle`s: effective tree → projection → (optionally) Monte Carlo
// → (optionally) the scenario's change set and its resolution maps.
//
// Extracted from render-presentation-pdf.ts so the PDF export and the Scenario
// Comparison AI generator build their columns the same way. They had diverged
// on the day the second copy landed — the copy lost the export's error mapping,
// its per-ref Monte Carlo gating and its snapshot-name resolution — which is
// exactly the drift a single implementation prevents. Both callers now share
// this one.
//
// Deliberately NOT the max-spend solve: that depends on (scenario, target) and
// each caller drives it from its own source (the export from every page's
// `maxSpendRefs` hook, the AI path from one page's options), so it stays with
// the callers and attaches to the bundles this returns.

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioSnapshots } from "@/db/schema";
import { runProjectionWithEvents } from "@/engine/projection";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { loadScenarioChangesContext } from "@/lib/scenario/load-scenario-changes-context";
import { keyForRef, labelForRef, type DistinctBundlePlan } from "@/lib/scenario/presentation-refs";
import type { InvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import type { ScenarioChangesContext } from "@/lib/presentations/pages/scenario-changes/types";
import type { PageScenarioBundle } from "@/components/presentations/document";

export interface LoadPageScenarioBundlesArgs {
  clientId: string;
  firmId: string;
  /** What to build, one entry per ref. Must be distinct by `keyForRef(ref)` —
   *  both callers derive them from a de-duplicated set, and a repeat would pay
   *  for the same projection twice. `planScenarioBundles` produces these. */
  requests: DistinctBundlePlan[];
  /** The firm's investment-option catalog, memoized by the CALLER: the export
   *  shares one memo with its Life Insurance pass, so this module must not own
   *  it. Only invoked when a ref actually carries a reinvestment change. */
  getInvestmentCatalog: () => Promise<InvestmentOptionCatalog>;
  /** Prefixes the non-fatal console logs so a failure can be traced to the
   *  path that triggered it. */
  logContext: string;
}

/** Human-readable names for every live scenario AND snapshot id in the plan, in
 *  two batched queries. Snapshots must be resolved too: without them
 *  `labelForRef` falls back to the literal "Snapshot", and a column named
 *  "Snapshot" in one consumer while the sheet beside it prints the real name is
 *  a silent mismatch — `hashBand` does not include the name, so a wrong name
 *  never regenerates itself.
 *
 *  firmId scoping is enforced per-tree by `loadEffectiveTreeForRef` below (it
 *  throws on a cross-org id before any name is used). */
async function resolveRefNames(requests: DistinctBundlePlan[]): Promise<Map<string, string>> {
  const liveScenarioIds: string[] = [];
  const snapshotIds: string[] = [];
  for (const { ref } of requests) {
    if (ref.kind === "snapshot") snapshotIds.push(ref.id);
    else if (ref.id !== "base") liveScenarioIds.push(ref.id);
  }

  const names = new Map<string, string>();
  if (liveScenarioIds.length > 0) {
    const rows = await db
      .select({ id: scenarios.id, name: scenarios.name })
      .from(scenarios)
      .where(inArray(scenarios.id, liveScenarioIds));
    for (const r of rows) names.set(r.id, r.name);
  }
  if (snapshotIds.length > 0) {
    const rows = await db
      .select({ id: scenarioSnapshots.id, name: scenarioSnapshots.name })
      .from(scenarioSnapshots)
      .where(inArray(scenarioSnapshots.id, snapshotIds));
    for (const r of rows) names.set(r.id, r.name);
  }
  return names;
}

/**
 * Build one bundle per requested ref, keyed by `keyForRef` so callers can look
 * them up the same way the renderer does.
 *
 * Projection always; Monte Carlo and the scenario change set only where the
 * request asks for them. The refs are independent and bounded by
 * MAX_DISTINCT_SCENARIOS, so they build concurrently.
 *
 * Failure policy, preserved from the export route:
 *  - a missing client throws `ClientNotFoundError` (→ 404),
 *  - unusable client data throws `ProjectionInputError` with a SCRUBBED
 *    message (→ 422). The raw message embeds internal client / CRM-household
 *    UUIDs (audit F4), so it is logged server-side and never returned,
 *  - first error wins, matching the original serial loop's early returns,
 *  - everything else — Monte Carlo, the change set, the reinvestment
 *    enrichment — is non-fatal and degrades that part of the page.
 */
export async function loadPageScenarioBundles(
  args: LoadPageScenarioBundlesArgs,
): Promise<Record<string, PageScenarioBundle>> {
  const { clientId, firmId, requests, getInvestmentCatalog, logContext } = args;

  const refNames = await resolveRefNames(requests);

  type BundleResult =
    | { kind: "ok"; key: string; bundle: PageScenarioBundle }
    | { kind: "notFound" }
    | { kind: "invalidInput" };

  const results = await Promise.all(
    requests.map(async (d): Promise<BundleResult> => {
      let clientData;
      try {
        const { effectiveTree } = await loadEffectiveTreeForRef(clientId, firmId, d.ref);
        clientData = effectiveTree;
      } catch (err) {
        if (err instanceof ClientNotFoundError) {
          return { kind: "notFound" };
        }
        if (err instanceof ProjectionInputError) {
          console.error(`${logContext} projection input error`, err);
          return { kind: "invalidInput" };
        }
        throw err;
      }

      const projection = runProjectionWithEvents(clientData);

      // Monte Carlo: served from the compute cache (or computed + stored on
      // miss). Snapshots have no live scenario row so they fall back to the
      // base seed, matching the long-standing inline behaviour.
      let monteCarlo: MonteCarloReportPayload | null = null;
      if (d.needsMonteCarlo) {
        try {
          const cached = await getOrComputeMonteCarlo({
            clientId,
            firmId,
            scenarioId: d.ref.kind === "scenario" ? d.ref.id : "base",
          });
          monteCarlo = cached.payload;
        } catch (mcErr) {
          // Non-fatal: leave monteCarlo null so the page renders its graceful
          // "data unavailable" frame instead of failing the whole render.
          console.error(`${logContext} Monte Carlo cache fetch failed`, mcErr);
        }
      }

      // The scenario's raw edits, for any consumer that prints or describes
      // them. loadScenarioChanges returns enabled rows only — matching what the
      // overlaid clientData already reflects.
      //
      // Org-scoping note: the scenarioId is proven to belong to this
      // firm/client by the loadEffectiveTreeForRef() call above. Do not remove
      // or lazily defer that call — see load-scenario-changes-context.ts.
      let scenarioChanges: ScenarioChangesContext | undefined;
      if (d.needsScenarioChanges && d.ref.kind === "scenario") {
        try {
          scenarioChanges = await loadScenarioChangesContext({
            scenarioId: d.ref.id,
            clientId,
            clientData,
            projection,
            getInvestmentCatalog,
            logContext,
          });
        } catch (scErr) {
          // Non-fatal: leave undefined so the page renders its empty state.
          console.error(`${logContext} scenario changes load failed`, scErr);
        }
      }

      return {
        kind: "ok",
        key: keyForRef(d.ref),
        bundle: {
          clientData,
          projection,
          scenarioLabel: labelForRef(d.ref, refNames),
          monteCarlo,
          scenarioChanges,
        },
      };
    }),
  );

  const firstErr = results.find((r) => r.kind !== "ok");
  if (firstErr?.kind === "notFound") {
    throw new ClientNotFoundError(clientId);
  }
  if (firstErr?.kind === "invalidInput") {
    throw new ProjectionInputError("Client data is incomplete or invalid for this projection.");
  }

  const bundles: Record<string, PageScenarioBundle> = {};
  for (const r of results) {
    if (r.kind === "ok") bundles[r.key] = r.bundle;
  }
  return bundles;
}
