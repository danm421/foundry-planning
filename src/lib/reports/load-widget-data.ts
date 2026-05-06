// src/lib/reports/load-widget-data.ts
//
// Shared server-only helper. Given a client id, firm id, and the report's
// pages, runs the projection, fans out to the scope registry, and returns
// the per-widget data dictionary the screen and PDF renders consume via
// `<Render data={widgetData[w.id]} />`.
//
// Used by both the export-pdf route (PDF render) and the report builder
// page (so the on-screen canvas renders real charts instead of empty
// snapshots).
//
// When a report has `comparisonBinding` set (Phase 3 of the
// ethos-style-reports plan), this also loads both projections via
// `loadComparisonScope` and attaches the result under the reserved key
// `__comparison` so Phase-5 comparison-aware widgets can read both sides
// without each loading their own data.

import { runProjection } from "@/engine/projection";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { deriveLegacyOwnership } from "@/components/balance-sheet-report/derive-ownership";
import type { FamilyMember } from "@/engine/types";
import {
  collectScopesFromTree,
  loadDataForScopes,
  buildWidgetData,
} from "@/lib/reports/data-loader";
import { loadComparisonScope } from "@/lib/reports/scopes/comparison";
import type { ComparisonBinding, Page } from "@/lib/reports/types";

/** Reserved widget-data key holding the resolved `ComparisonScopeData` when
 *  the report has a `comparisonBinding`. Comparison-aware widgets read
 *  from this key directly; everything else ignores it. The key is
 *  prefixed with `__` so it can never collide with a widget id (UUIDs). */
export const COMPARISON_DATA_KEY = "__comparison";

export async function loadReportWidgetData(args: {
  clientId: string;
  firmId: string;
  pages: Page[];
  dateOfBirth: string;
  retirementAge: number;
  comparisonBinding?: ComparisonBinding | null;
}): Promise<Record<string, unknown>> {
  const { clientId, firmId, pages, dateOfBirth, retirementAge, comparisonBinding } = args;

  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
  const apiData = effectiveTree as unknown as {
    accounts: Array<{
      id: string;
      name: string;
      category: string;
      owners: Parameters<typeof deriveLegacyOwnership>[0];
    }>;
    liabilities: Array<{
      id: string;
      name: string;
      owners: Parameters<typeof deriveLegacyOwnership>[0];
      linkedPropertyId?: string | null;
    }>;
    entities?: Array<{ id: string; name?: string; entityType?: string }>;
    familyMembers?: FamilyMember[];
  };
  const projection = runProjection(effectiveTree);

  const roleById = new Map<string, FamilyMember["role"]>(
    (apiData.familyMembers ?? []).map((fm) => [fm.id, fm.role]),
  );
  const accounts = apiData.accounts.map((a) => {
    const { owner, ownerEntityId } = deriveLegacyOwnership(
      a.owners ?? [],
      roleById,
    );
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      owner: owner ?? "client",
      ownerEntityId,
    };
  });
  const liabilities = apiData.liabilities.map((l) => {
    const { owner, ownerEntityId } = deriveLegacyOwnership(
      l.owners ?? [],
      roleById,
    );
    return {
      id: l.id,
      name: l.name,
      owner,
      ownerEntityId,
      linkedPropertyId: l.linkedPropertyId ?? null,
    };
  });
  const entities = (apiData.entities ?? []).map((e) => ({
    id: e.id,
    name: e.name ?? "",
    entityType: e.entityType ?? "other",
  }));

  const scopes = collectScopesFromTree(pages);
  const scopeData = await loadDataForScopes(scopes, {
    client: { id: clientId },
    projection,
  });

  const birthYear = parseInt(dateOfBirth.slice(0, 4), 10);
  const household = {
    retirementYear: birthYear + retirementAge,
    currentYear: new Date().getFullYear(),
  };

  const widgetData = buildWidgetData(pages, {
    projection,
    scopeData,
    client: { id: clientId },
    accounts,
    liabilities,
    entities,
    household,
  });

  if (comparisonBinding) {
    const comparison = await loadComparisonScope({
      clientId,
      firmId,
      currentScenarioId: comparisonBinding.currentScenarioId,
      proposedScenarioId: comparisonBinding.proposedScenarioId,
    });
    widgetData[COMPARISON_DATA_KEY] = comparison;
  }

  return widgetData;
}
