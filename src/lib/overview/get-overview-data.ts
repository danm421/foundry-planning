import { db } from "@/db";
import { accounts, clients } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { listOpenItems } from "./list-open-items";
import { listAuditRows } from "./list-audit-rows";
import { getAssetAllocationByType } from "./get-asset-allocation-by-type";
import { deriveNetWorthSeries } from "./derive-net-worth-series";
import { deriveLifeEvents, type OverviewLifeEvent } from "./derive-life-events";
import { ClientNotFoundError } from "@/lib/projection/load-client-data";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { buildTimeline } from "@/lib/timeline/build-timeline";
import type { ProjectionYear } from "@/engine";

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

export async function getOverviewData(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

  if (!client) throw new ClientNotFoundError(clientId);

  const [allocation, openItemsAll, openItemsPreview, auditRows, accountRows] =
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
    ]);

  const netWorth = accountRows.reduce((sum, a) => sum + Number(a.value ?? 0), 0);
  const liquidPortfolio = accountRows
    .filter((a) => !LIQUID_CATEGORY_EXCLUDE.has(String(a.category)))
    .reduce((sum, a) => sum + Number(a.value ?? 0), 0);

  // Years-to-retirement — unchanged from before
  const currentYear = new Date().getFullYear();
  const retirementYears: number[] = [];
  if (client.retirementAge != null && client.dateOfBirth) {
    retirementYears.push(
      new Date(client.dateOfBirth).getFullYear() + client.retirementAge,
    );
  }
  if (client.spouseRetirementAge != null && client.spouseDob) {
    retirementYears.push(
      new Date(client.spouseDob).getFullYear() + client.spouseRetirementAge,
    );
  }
  const earliestRetirementYear = retirementYears.length
    ? Math.min(...retirementYears)
    : null;
  const yearsToRetirement =
    earliestRetirementYear != null
      ? Math.max(earliestRetirementYear - currentYear, 0)
      : null;

  // Projection-derived fields — fail-soft
  let projection: ProjectionYear[] | null = null;
  let projectionError: string | null = null;
  let clientData;
  try {
    ({ effectiveTree: clientData } = await loadEffectiveTree(clientId, firmId, "base", {}));
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
    runway: { netWorthSeries, minNetWorth },
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
