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

import { runProjection } from "@/engine/projection";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import type { FamilyMember } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import {
  collectScopesFromTree,
  loadDataForScopes,
  buildWidgetData,
} from "@/lib/reports/data-loader";
import type { Page } from "@/lib/reports/types";

export async function loadReportWidgetData(args: {
  clientId: string;
  firmId: string;
  pages: Page[];
  dateOfBirth: string;
  retirementAge: number;
}): Promise<Record<string, unknown>> {
  const { clientId, firmId, pages, dateOfBirth, retirementAge } = args;

  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
  const apiData = effectiveTree as unknown as {
    accounts: Array<{
      id: string;
      name: string;
      category: string;
      owners: AccountOwner[];
    }>;
    liabilities: Array<{
      id: string;
      name: string;
      owners: AccountOwner[];
      linkedPropertyId?: string | null;
    }>;
    entities?: Array<{
      id: string;
      name?: string;
      entityType?: string;
      isIrrevocable?: boolean;
      value?: number;
      owners?: Array<{ familyMemberId: string; percent: number }>;
    }>;
    familyMembers?: FamilyMember[];
  };
  const projection = runProjection(effectiveTree);

  const familyMembers = apiData.familyMembers ?? [];
  const accounts = apiData.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    owners: a.owners ?? [],
  }));
  const liabilities = apiData.liabilities.map((l) => ({
    id: l.id,
    name: l.name,
    owners: l.owners ?? [],
    linkedPropertyId: l.linkedPropertyId ?? null,
  }));
  const entities = (apiData.entities ?? []).map((e) => ({
    id: e.id,
    name: e.name ?? "",
    entityType: e.entityType ?? "other",
    isIrrevocable: e.isIrrevocable,
    value: e.value,
    owners: e.owners,
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

  return buildWidgetData(pages, {
    projection,
    scopeData,
    client: { id: clientId },
    accounts,
    liabilities,
    entities,
    familyMembers,
    household,
  });
}
