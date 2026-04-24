import { db } from "@/db";
import { accounts, clients } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { listOpenItems } from "./list-open-items";
import { listAuditRows } from "./list-audit-rows";
import { getAssetAllocationByType } from "./get-asset-allocation-by-type";
import { computeAlerts, type Alert } from "@/lib/alerts";

const LIQUID_CATEGORY_EXCLUDE = new Set([
  "real_estate",
  "business",
  "life_insurance",
]);

export async function getOverviewData(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

  if (!client) throw new Error("Client not found");

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

  // Net worth: sum of all account values. NOTE: liabilities are NOT subtracted
  // here — this is a crude proxy. Real NW requires subtracting liability balances.
  // Tracked in future-work/ui.md.
  const netWorth = accountRows.reduce(
    (sum, a) => sum + Number(a.value ?? 0),
    0,
  );

  const liquidPortfolio = accountRows
    .filter((a) => !LIQUID_CATEGORY_EXCLUDE.has(String(a.category)))
    .reduce((sum, a) => sum + Number(a.value ?? 0), 0);

  // Years to retirement — schema uses retirementAge (integer) + dateOfBirth (date).
  // Derive retirement year as birthYear + retirementAge, then compute delta from today.
  const currentYear = new Date().getFullYear();
  const retirementYears: number[] = [];

  if (client.retirementAge != null && client.dateOfBirth) {
    const clientBirthYear = new Date(client.dateOfBirth).getFullYear();
    retirementYears.push(clientBirthYear + client.retirementAge);
  }
  if (client.spouseRetirementAge != null && client.spouseDob) {
    const spouseBirthYear = new Date(client.spouseDob).getFullYear();
    retirementYears.push(spouseBirthYear + client.spouseRetirementAge);
  }

  const earliestRetirementYear = retirementYears.length
    ? Math.min(...retirementYears)
    : null;
  const yearsToRetirement =
    earliestRetirementYear != null
      ? Math.max(earliestRetirementYear - currentYear, 0)
      : null;

  // TODO: wire to runProjection + runMonteCarlo once a server-side loadClientData
  //       helper exists. Tracked in future-work/ui.md.
  const monteCarloSuccess: number | null = null;
  const netWorthSeries: number[] = [];
  const lifeEvents: { year: number; label: string }[] = [];

  const alerts: Alert[] = computeAlerts(
    { id: client.id, updatedAt: client.updatedAt },
    {
      monteCarloSuccess,
      liquidPortfolio,
      currentYearNetOutflow: 0, // placeholder until projection exists
      minNetWorth: netWorth, // use current NW as floor proxy
    },
  );

  const totalOpen = openItemsAll.filter((i) => !i.completedAt).length;
  const totalCompleted = openItemsAll.filter((i) => !!i.completedAt).length;

  return {
    client,
    kpi: {
      netWorth,
      liquidPortfolio,
      monteCarloSuccess,
      yearsToRetirement,
    },
    runway: {
      monteCarloSuccess,
      netWorthSeries,
    },
    allocation,
    lifeEvents,
    openItemsPreview,
    totalOpen,
    totalCompleted,
    alerts,
    auditRows,
    accountCount: accountRows.length,
  };
}
