// src/lib/scenario/loader.ts
import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accountFlowOverrides, clients, entityFlowOverrides, scenarioSnapshots, scenarios } from "@/db/schema";
import { loadClientDataWithContext } from "@/lib/projection/load-client-data";
import {
  resolveAccountFromRaw,
  resolveIncomeFromRaw,
  resolveExpenseFromRaw,
  resolveSavingsRuleFromRaw,
  type ResolutionContext,
} from "@/lib/projection/resolve-entity";
import type { AccountFlowOverride, ClientData, EntityFlowOverride } from "@/engine/types";
import {
  applyScenarioChanges,
  resolveEffectiveToggleState,
} from "@/engine/scenario/applyChanges";
import type {
  CascadeWarning,
  ScenarioChange,
  ToggleGroup,
  ToggleState,
} from "@/engine/scenario/types";
import { resolveReinvestments } from "@/lib/projection/resolve-reinvestments";
import { reResolveInflationGrowth } from "@/lib/projection/resolve-inflation-growth";
import { withSynthesizedPremiums } from "@/lib/insurance-policies/premium-expense";
import { withSynthesizedPolicyIncome } from "@/lib/insurance-policies/policy-income";
import { withSynthesizedPremiumGifts } from "@/lib/insurance-policies/premium-gift";
import { resolveRefYears } from "@/lib/year-refs";
import { applyGiftOverlays } from "./apply-gift-overlays";
import { loadScenarioChanges, loadScenarioToggleGroups } from "./changes";

/**
 * Walks an `add` change's raw payload through the matching resolver so the
 * engine receives a fully-resolved entity (numeric growthRate, realization,
 * category-specific overrides) instead of the raw form payload that the
 * scenario writer persists. Mirrors `loadClientData`'s base path.
 *
 * Other targetKinds (entity, will, etc.) and edit/remove ops fall through
 * unchanged — `applyScenarioChanges` handles their coercion.
 */
export function resolveAddPayload(
  change: ScenarioChange,
  ctx: ResolutionContext,
): ScenarioChange {
  if (change.opType !== "add") return change;
  const raw = change.payload as Record<string, unknown>;
  switch (change.targetKind) {
    case "account":
      return { ...change, payload: resolveAccountFromRaw(raw as never, ctx) };
    case "income":
      return { ...change, payload: resolveIncomeFromRaw(raw as never, ctx) };
    case "expense":
      return { ...change, payload: resolveExpenseFromRaw(raw as never, ctx) };
    case "savings_rule":
      return { ...change, payload: resolveSavingsRuleFromRaw(raw as never, ctx) };
    default:
      return change;
  }
}

export interface LoadEffectiveTreeResult {
  effectiveTree: ClientData;
  warnings: CascadeWarning[];
  /** Resolution context from the base client-data load. Used by the live
   *  solver to re-resolve reinvestments added/edited via solver mutations.
   *  Optional because `applyScenarioChangesWithRefs` (used directly in some
   *  tests) does not always have one. */
  resolutionContext?: ResolutionContext;
}

/**
 * Applies scenario changes, then reshifts every milestone-anchored
 * `startYear`/`endYear` via `resolveRefYears`.
 *
 * A scenario change can move a household milestone — retirement age, plan end
 * age, date of birth. The engine reads only the concrete `startYear`/`endYear`
 * on each income/expense/savings row, treating `*YearRef` as view metadata,
 * so a milestone move must be propagated to every dependent year window
 * before projection. The live solver already does this in `applyMutations`;
 * the persisted-scenario reload path has to do the same — otherwise a saved
 * "retire at 67" scenario reloads with stale age-65 windows and projects
 * identically to base.
 *
 * Reinvestment re-resolution: a scenario `add`/`edit` merges a RAW-shaped
 * reinvestment payload (modelPortfolioId / customGrowthRate / customPct*)
 * onto the effective tree without resolving it. After `applyScenarioChanges`,
 * the effective tree's reinvestments are re-run through `resolveReinvestments`
 * — using the `resolutionContext` from the base load — so that added, edited,
 * and unchanged reinvestments all carry correct `newGrowthRate` /
 * `newRealization` / `soldFractionByAccount`. `resolveReinvestments` is
 * idempotent, so unchanged base reinvestments resolve to the same values.
 * When `resolutionContext` is omitted (e.g. unit tests that exercise only the
 * year-ref reshift), reinvestments are left as `applyScenarioChanges` produced
 * them.
 *
 * Inflation re-resolution: base accounts / incomes / expenses / savings rules
 * had their growthRate resolved under the base inflation rate. If a scenario
 * edits `plan_settings.inflationRate`, `reResolveInflationGrowth` recomputes the
 * resolved rate from the effective plan settings and re-applies it to every
 * inflation-sourced entity. No-ops (same tree) when the rate is unchanged.
 *
 * Premium re-synthesis: life-insurance premium expenses are re-derived from the
 * effective accounts via `withSynthesizedPremiums`. Base-load synthesis runs on
 * the BASE accounts, so without this a scenario that added / removed / edited a
 * life-insurance account would carry missing / orphaned / stale premiums. The
 * re-derivation is idempotent.
 */
export function applyScenarioChangesWithRefs(
  treeForChanges: ClientData,
  changes: ScenarioChange[],
  toggleState: ToggleState,
  groups: ToggleGroup[],
  resolutionContext?: ResolutionContext,
): LoadEffectiveTreeResult {
  const giftChanges = changes.filter((c) => c.targetKind === "gift");
  const nonGiftChanges = changes.filter((c) => c.targetKind !== "gift");
  const { effectiveTree, warnings } = applyScenarioChanges(
    treeForChanges,
    nonGiftChanges,
    toggleState,
    groups,
  );

  const refResolved = resolveRefYears(effectiveTree);

  // Approach A: re-derive giftEvents from any scenario gift drafts that
  // applyScenarioChanges appended to tree.gifts. A solver-saved planned gift is
  // persisted as a `gift` overlay carrying an EstateFlowGift draft; the generic
  // replay appends it to `tree.gifts` (typed Gift[]) without rebuilding the
  // engine's derived `giftEvents`. This runs the drafts through the same
  // applyGiftsToClientData bridge the live solver uses and merges the derived
  // gifts/giftEvents back in. Must run before the premium chain
  // (withSynthesizedPremiumGifts strips only policy-sourced cash events, so
  // scenario gifts survive). No-op (returns the same tree reference) when no
  // draft entries are present, so the no-gift path is byte-identical.
  const giftCpi =
    refResolved.planSettings.taxInflationRate ??
    refResolved.planSettings.inflationRate ??
    0;
  const giftNormalized = applyGiftOverlays(refResolved, giftChanges, giftCpi);

  if (resolutionContext && giftNormalized.reinvestments) {
    giftNormalized.reinvestments = resolveReinvestments(giftNormalized.reinvestments, {
      resolver: resolutionContext.resolver,
      accountBaseAllocByAccountId:
        resolutionContext.accountBaseAllocByAccountId ?? new Map(),
    });
  }

  // Re-resolve inflation-driven growth rates. Base entities were resolved under
  // the base inflation rate; if the scenario edited `plan_settings.inflationRate`
  // the resolved rate changes and every inflation-sourced account / income /
  // expense / savings rule must follow. No-ops (returns the same tree) when the
  // rate is unchanged, so non-inflation scenarios stay byte-identical.
  const inflationResolved = resolutionContext
    ? reResolveInflationGrowth(giftNormalized, resolutionContext)
    : giftNormalized;

  // Re-synthesize life-insurance premium expenses over the effective accounts.
  // Base-load synthesis ran on the BASE accounts, so a scenario that added,
  // removed, or edited a life-insurance account would otherwise leave the tree
  // with missing / orphaned / stale premiums. Idempotent — unchanged policies
  // re-derive to the same expense rows.
  const withPremiums = withSynthesizedPremiums(inflationResolved);
  // Re-synthesize life-insurance scheduled income over the same effective
  // accounts. Idempotent — strips prior policy-income rows and re-derives.
  const withPolicyIncome = withSynthesizedPolicyIncome(withPremiums);
  // Re-derive life-insurance premium gifts from the effective tree's current
  // life-insurance accounts + entities + familyMembers. Idempotent — strips
  // prior policy gifts and re-derives. Must run OUTERMOST so it sees the
  // effective tree after premium + income synthesis.
  const withPremiumGifts = withSynthesizedPremiumGifts(withPolicyIncome);

  return { effectiveTree: withPremiumGifts, warnings };
}

export const loadEffectiveTree = cache(
  async (
    clientId: string,
    firmId: string,
    scenarioId: string | "base",
    toggleState: ToggleState,
  ): Promise<LoadEffectiveTreeResult> => {
    const { clientData: baseTree, resolutionContext } =
      await loadClientDataWithContext(clientId, firmId);

    let resolvedScenario;
    if (scenarioId === "base") {
      const [s] = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
      if (!s) throw new Error(`Client ${clientId} has no base case scenario`);
      resolvedScenario = s;
    } else {
      const [s] = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)));
      if (!s) throw new Error(`Scenario ${scenarioId} not found for client ${clientId}`);
      resolvedScenario = s;
    }

    // Fast path: when scenarioId resolves to the client's base case AND no
    // toggles are explicitly set, we can return baseTree directly. The base
    // tree already carries the base (scenario_id IS NULL) flow overrides.
    //
    // We still need to filter notes_receivable rows that point to a toggle
    // group, because the base view doesn't activate any group — those notes
    // belong to non-base scenarios (e.g. IDGT sale_to_trust) and shouldn't
    // appear here. This mirrors what the full filter below would compute:
    // `resolveEffectiveToggleState({}, [])` returns {}, so any note with a
    // non-null toggleGroupId would fail `effective[gid] === true` and be
    // dropped. We can achieve the same result without loading groups by
    // simply dropping every note whose toggleGroupId is non-null.
    if (resolvedScenario.isBaseCase && Object.keys(toggleState).length === 0) {
      const filteredBase = baseTree.notesReceivable
        ? {
            ...baseTree,
            notesReceivable: baseTree.notesReceivable.filter(
              (n) => n.toggleGroupId == null,
            ),
          }
        : baseTree;
      return { effectiveTree: filteredBase, warnings: [], resolutionContext };
    }

    const entityIds = baseTree.entities?.map((e) => e.id) ?? [];
    const businessAccountIds =
      baseTree.accounts
        ?.filter((a) => a.category === "business" && a.parentAccountId == null)
        .map((a) => a.id) ?? [];
    const [changes, groups, scenarioFlowOverrideRows, scenarioAccountFlowOverrideRows] = await Promise.all([
      loadScenarioChanges(resolvedScenario.id),
      loadScenarioToggleGroups(resolvedScenario.id),
      // Per-entity scenario flow overrides. Empty entity list → skip the
      // query (Postgres rejects `IN ()`).
      resolvedScenario.isBaseCase || entityIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              entityId: entityFlowOverrides.entityId,
              year: entityFlowOverrides.year,
              incomeAmount: entityFlowOverrides.incomeAmount,
              expenseAmount: entityFlowOverrides.expenseAmount,
              distributionPercent: entityFlowOverrides.distributionPercent,
            })
            .from(entityFlowOverrides)
            .where(
              and(
                inArray(entityFlowOverrides.entityId, entityIds),
                eq(entityFlowOverrides.scenarioId, resolvedScenario.id),
              ),
            ),
      // Per-business-account scenario flow overrides. Parallel to the entity
      // case above; same isBaseCase + empty-list short-circuit semantics.
      resolvedScenario.isBaseCase || businessAccountIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              accountId: accountFlowOverrides.accountId,
              year: accountFlowOverrides.year,
              incomeAmount: accountFlowOverrides.incomeAmount,
              expenseAmount: accountFlowOverrides.expenseAmount,
              distributionPercent: accountFlowOverrides.distributionPercent,
            })
            .from(accountFlowOverrides)
            .where(
              and(
                inArray(accountFlowOverrides.accountId, businessAccountIds),
                eq(accountFlowOverrides.scenarioId, resolvedScenario.id),
              ),
            ),
    ]);

    // Per-entity inheritance: the writer at PUT
    // /api/clients/[id]/entities/[entityId]/flow-overrides?scenarioId=…
    // replaces flow overrides for a single (entity, scenario) pair, so the
    // natural granularity for inheritance is also per-entity. For each entity:
    //   • scenario has any rows → use ONLY the scenario's rows for that entity
    //   • scenario has no rows  → inherit the base entity's rows
    // This way a fresh non-base scenario (no scenario-scoped rows yet) is
    // exactly equivalent to base for entity flows, instead of silently
    // zeroing them out.
    const scenarioEntityIdsWithOverrides = new Set(
      scenarioFlowOverrideRows.map((r) => r.entityId),
    );
    const inheritedBaseRows = (baseTree.entityFlowOverrides ?? []).filter(
      (r) => !scenarioEntityIdsWithOverrides.has(r.entityId),
    );
    // Same per-key inheritance for account flow overrides: if the scenario has
    // any rows for a given business account, those replace base; otherwise
    // that business's base rows pass through unchanged.
    const scenarioAccountIdsWithOverrides = new Set(
      scenarioAccountFlowOverrideRows.map((r) => r.accountId),
    );
    const inheritedBaseAccountRows = (baseTree.accountFlowOverrides ?? []).filter(
      (r) => !scenarioAccountIdsWithOverrides.has(r.accountId),
    );
    const treeForChanges: ClientData = resolvedScenario.isBaseCase
      ? baseTree
      : {
          ...baseTree,
          entityFlowOverrides: [
            ...inheritedBaseRows,
            ...scenarioFlowOverrideRows.map(
              (r): EntityFlowOverride => ({
                entityId: r.entityId,
                year: r.year,
                incomeAmount: r.incomeAmount != null ? parseFloat(r.incomeAmount) : null,
                expenseAmount: r.expenseAmount != null ? parseFloat(r.expenseAmount) : null,
                distributionPercent:
                  r.distributionPercent != null ? parseFloat(r.distributionPercent) : null,
              }),
            ),
          ],
          accountFlowOverrides: [
            ...inheritedBaseAccountRows,
            ...scenarioAccountFlowOverrideRows.map(
              (r): AccountFlowOverride => ({
                accountId: r.accountId,
                year: r.year,
                incomeAmount: r.incomeAmount != null ? parseFloat(r.incomeAmount) : null,
                expenseAmount: r.expenseAmount != null ? parseFloat(r.expenseAmount) : null,
                distributionPercent:
                  r.distributionPercent != null ? parseFloat(r.distributionPercent) : null,
              }),
            ),
          ],
        };

    const resolvedChanges = changes.map((c) => resolveAddPayload(c, resolutionContext));

    const result = applyScenarioChangesWithRefs(
      treeForChanges,
      resolvedChanges,
      toggleState,
      groups,
      resolutionContext,
    );

    // Filter notes_receivable by ToggleState. Notes with toggleGroupId === null
    // always pass; otherwise the row passes iff its group resolves "on" in the
    // effective toggle state — `resolveEffectiveToggleState` walks the
    // `requiresGroupId` chain so child groups inherit "off" from their parents,
    // matching how `applyScenarioChanges` treats scenario_change rows under the
    // same group.
    if (result.effectiveTree.notesReceivable) {
      const effective = resolveEffectiveToggleState(toggleState, groups);
      result.effectiveTree = {
        ...result.effectiveTree,
        notesReceivable: result.effectiveTree.notesReceivable.filter(
          (n) => n.toggleGroupId == null || effective[n.toggleGroupId] === true,
        ),
      };
    }

    return { ...result, resolutionContext };
  },
);

/**
 * Discriminated union identifying which "tree" to load for a client. Either
 * (a) a live scenario id (or "base") with a ToggleState — recomputed from
 * base + changes via `loadEffectiveTree`, or (b) a frozen snapshot ref —
 * returned verbatim from `scenario_snapshots.effective_tree_{left,right}`.
 */
export type ScenarioRef =
  | { kind: "scenario"; id: string | "base"; toggleState: ToggleState }
  | { kind: "snapshot"; id: string; side: "left" | "right" };

/**
 * Sibling of `loadEffectiveTree` that also accepts a snapshot ref. Snapshot
 * reads short-circuit to frozen JSON — no recompute, zero cascade warnings.
 *
 * Firm scoping: snapshots inherit firmId via the parent client (the table
 * has no firmId column). The snapshot path enforces it explicitly via an
 * inner-join on `clients` and an additional `clientId` equality check, so a
 * cross-firm snapshot id passed in by mistake throws rather than leaking.
 */
export async function loadEffectiveTreeForRef(
  clientId: string,
  firmId: string,
  ref: ScenarioRef,
): Promise<LoadEffectiveTreeResult> {
  if (ref.kind === "snapshot") {
    const [snap] = await db
      .select({
        effectiveTreeLeft: scenarioSnapshots.effectiveTreeLeft,
        effectiveTreeRight: scenarioSnapshots.effectiveTreeRight,
      })
      .from(scenarioSnapshots)
      .innerJoin(clients, eq(clients.id, scenarioSnapshots.clientId))
      .where(
        and(
          eq(scenarioSnapshots.id, ref.id),
          eq(scenarioSnapshots.clientId, clientId),
          eq(clients.firmId, firmId),
        ),
      );
    if (!snap) {
      throw new Error(`Snapshot ${ref.id} not found for client ${clientId}`);
    }

    const tree =
      ref.side === "left"
        ? (snap.effectiveTreeLeft as ClientData)
        : (snap.effectiveTreeRight as ClientData);
    return { effectiveTree: tree, warnings: [] };
  }

  return loadEffectiveTree(clientId, firmId, ref.id, ref.toggleState);
}
