import { db } from "@/db";
import { accounts, clients, crmHouseholdContacts, entities, entityOwners } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { listOpenItems } from "./list-open-items";
import { listAuditRows } from "./list-audit-rows";
import { getAssetAllocationByType } from "./get-asset-allocation-by-type";
import { deriveNetWorthSeries } from "./derive-net-worth-series";
import { deriveLifeEvents, type OverviewLifeEvent } from "./derive-life-events";
import { ClientNotFoundError } from "@/lib/projection/load-client-data";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { buildTimeline } from "@/lib/timeline/build-timeline";
import {
  personRetirementFacts,
  yearsUntilFirstRetirement,
  type PersonRetirementFacts,
} from "@/lib/retirement/retirement-facts";
import type { ProjectionYear } from "@/engine";
import type { ToggleState } from "@/engine/scenario/types";

const LIQUID_CATEGORY_EXCLUDE = new Set([
  "real_estate",
  "business",
  "life_insurance",
]);

export type OverviewAlertInputs = {
  liquidPortfolio: number;
  currentYearNetOutflow: number;
  minNetWorth: number;
  projectionError: string | null;
};

export async function getOverviewData(
  clientId: string,
  firmId: string,
  scenarioId: string | "base" = "base",
  toggleState: ToggleState = {},
) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

  if (!client) throw new ClientNotFoundError(clientId);

  // CRM contacts: source of truth for identity (DOB drives retirement timing).
  const crmContactRows = client.crmHouseholdId
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId))
    : [];
  const primaryContact = crmContactRows.find((c) => c.role === "primary") ?? null;
  const spouseContact = crmContactRows.find((c) => c.role === "spouse") ?? null;

  const [allocation, openItemsAll, openItemsPreview, auditRows, accountRows, entityRows] =
    await Promise.all([
      getAssetAllocationByType(clientId, firmId),
      listOpenItems(clientId, firmId, { open: false, limit: 500 }),
      listOpenItems(clientId, firmId, { open: true, limit: 5 }),
      listAuditRows(clientId, firmId, { limit: 10 }),
      db
        .select({
          id: accounts.id,
          category: accounts.category,
          value: accounts.value,
        })
        .from(accounts)
        .where(eq(accounts.clientId, clientId)),
      db
        .select({
          id: entities.id,
          entityType: entities.entityType,
          value: entities.value,
        })
        .from(entities)
        .where(eq(entities.clientId, clientId)),
    ]);

  // Family-owned share of each business-entity flat valuation. Mirrors the
  // balance-sheet rule: missing entity_owners rows → fully family-owned
  // (legacy back-compat); rows summing to ~1 → 100%; partial → proportional.
  const BUSINESS_ENTITY_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);
  const businessEntityIds = entityRows
    .filter((e) => e.entityType && BUSINESS_ENTITY_TYPES.has(e.entityType))
    .map((e) => e.id);
  const ownerRows = businessEntityIds.length > 0
    ? await db
        .select({
          entityId: entityOwners.entityId,
          percent: entityOwners.percent,
        })
        .from(entityOwners)
        .where(inArray(entityOwners.entityId, businessEntityIds))
    : [];
  const ownerSumByEntity = new Map<string, number>();
  for (const row of ownerRows) {
    ownerSumByEntity.set(
      row.entityId,
      (ownerSumByEntity.get(row.entityId) ?? 0) + parseFloat(row.percent),
    );
  }
  const businessFlatInEstate = entityRows.reduce((sum, e) => {
    if (!e.entityType || !BUSINESS_ENTITY_TYPES.has(e.entityType)) return sum;
    const v = Number(e.value ?? 0);
    if (v <= 0) return sum;
    const familyShare = ownerRows.some((o) => o.entityId === e.id)
      ? Math.max(0, Math.min(1, ownerSumByEntity.get(e.id) ?? 0))
      : 1;
    return sum + v * familyShare;
  }, 0);

  const netWorth =
    accountRows.reduce((sum, a) => sum + Number(a.value ?? 0), 0) + businessFlatInEstate;
  const liquidPortfolio = accountRows
    .filter((a) => !LIQUID_CATEGORY_EXCLUDE.has(String(a.category)))
    .reduce((sum, a) => sum + Number(a.value ?? 0), 0);

  // Per-person retirement age + calendar year — the single source of truth for
  // retirement timing. `yearsToRetirement` alone is ambiguous downstream (the
  // 360 AI battery consumes it and had no age/year to check advisor notes
  // against), so derive the KPI from these rather than re-deriving in parallel.
  const now = new Date();
  const factsFor = (
    contact: typeof primaryContact,
    retirementAge: number | null,
  ): PersonRetirementFacts | null =>
    contact ? personRetirementFacts({ ...contact, retirementAge }, now) : null;

  const retirementPeople = [
    factsFor(primaryContact, client.retirementAge),
    factsFor(spouseContact, client.spouseRetirementAge),
  ].filter((p): p is PersonRetirementFacts => p != null);

  const yearsToRetirement = yearsUntilFirstRetirement(retirementPeople, now);

  // Projection-derived fields — fail-soft
  let projection: ProjectionYear[] | null = null;
  let projectionError: string | null = null;
  let clientData;
  try {
    ({ effectiveTree: clientData } = await loadEffectiveTree(
      clientId,
      firmId,
      scenarioId,
      toggleState,
    ));
    projection = runProjection(clientData);
  } catch (err) {
    if (err instanceof ClientNotFoundError) throw err;
    projectionError = err instanceof Error ? err.message : "Projection failed";
    console.error(
      `[overview-pipeline] projection failed for clientId=${clientId}`,
      err,
    );
  }

  const netWorthSeries = projection ? deriveNetWorthSeries(projection) : [];

  let lifeEvents: OverviewLifeEvent[] = [];
  if (projection && clientData) {
    try {
      lifeEvents = deriveLifeEvents(buildTimeline(clientData, projection));
    } catch {
      // already logged above — keep lifeEvents empty
    }
  }

  const minNetWorth =
    netWorthSeries.length > 0 ? Math.min(...netWorthSeries) : netWorth;

  const currentYearNetOutflow = (() => {
    if (!projection || projection.length === 0) return 0;
    const y0 = projection[0];
    return Math.max(y0.expenses.total - y0.income.total, 0);
  })();

  const totalOpen = openItemsAll.filter((i) => !i.completedAt).length;
  const totalCompleted = openItemsAll.filter((i) => !!i.completedAt).length;

  const alertInputs: OverviewAlertInputs = {
    liquidPortfolio,
    currentYearNetOutflow,
    minNetWorth,
    projectionError,
  };

  return {
    client,
    kpi: { netWorth, liquidPortfolio, yearsToRetirement },
    retirementPeople,
    runway: { netWorthSeries, minNetWorth },
    projection: projection ?? [],
    allocation,
    lifeEvents,
    openItemsPreview,
    totalOpen,
    totalCompleted,
    alertInputs,
    auditRows,
    accountCount: accountRows.length,
  };
}
