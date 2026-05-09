import { z } from "zod";
import { createHash } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { DataTable } from "@/components/reports-pdf/widgets/data-table";
import { ChartImage } from "@/components/reports-pdf/widgets/chart-image";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  accounts as accountsTable,
  accountOwners,
  accountAssetAllocations,
  assetClasses as assetClassesTable,
  modelPortfolios,
  modelPortfolioAllocations,
} from "@/db/schema";
import {
  computeHouseholdAllocation,
  computeDrift,
  resolveAccountAllocation,
  type InvestableAccount,
  type AccountLite,
  type PlanSettingsLite,
  type AssetClassLite,
} from "@/lib/investments/allocation";
import { resolveBenchmark, type AssetClassWeight } from "@/lib/investments/benchmarks";
import type { AssetTypeId } from "@/lib/investments/asset-types";
import type { ReportArtifact, FetchDataResult } from "../types";
import { serializeCsv } from "../csv";

export const optionsSchema = z.object({
  drillDownClasses: z.array(z.string()).default([]),
});
export type InvestmentsOptions = z.infer<typeof optionsSchema>;

// Mirrors the HouseholdAllocation shape the page computes — but slimmed for
// PDF/CSV: only the byAssetClass rollup plus the per-account breakdown.
export type InvestmentsData = {
  clientName: string;
  household: {
    totalClassifiedValue: number;
    totalInvestableValue: number;
    unallocatedValue: number;
    byAssetClass: Array<{
      classId: string;
      label: string;
      value: number;
      pctOfClassified: number;
    }>;
  };
  drift: {
    benchmarkName: string | null;
    rows: Array<{
      classId: string;
      label: string;
      currentPct: number;
      targetPct: number;
      diffPct: number;
    }>;
  };
  perAccount: Array<{
    accountId: string;
    accountName: string;
    value: number;
    allocation:
      | { classified: Array<{ classId: string; label: string; weight: number }> }
      | { unallocated: true };
  }>;
};

async function fetchInvestmentsData(
  clientId: string,
  firmId: string,
  _opts: InvestmentsOptions,
): Promise<FetchDataResult<InvestmentsData>> {
  // Mirror src/app/(app)/clients/[id]/assets/investments/page.tsx exactly.
  // The screen and the PDF share the same data shape — that's the contract.

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) throw new Error(`Client ${clientId} not found`);

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) throw new Error("No base scenario");

  const [settings] = await db
    .select()
    .from(planSettings)
    .where(
      and(
        eq(planSettings.clientId, clientId),
        eq(planSettings.scenarioId, scenario.id),
      ),
    );
  if (!settings) throw new Error("No plan settings");

  // Firm scoping: account_asset_allocations and model_portfolio_allocations
  // have no firm_id. Firm-scope transitively: accounts by (clientId+scenarioId),
  // model_portfolios by firmId, then intersect allocations with those id sets.
  const [acctRows, mixRows, classRows, portfolioRows, portfolioAllocRows] = await Promise.all([
    db
      .select()
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.clientId, clientId),
          eq(accountsTable.scenarioId, scenario.id),
        ),
      ),
    db.select().from(accountAssetAllocations),
    db.select().from(assetClassesTable).where(eq(assetClassesTable.firmId, firmId)),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
  ]);

  // Build entity ownership map from junction table.
  const accountEntityOwner = new Map<string, string>();
  if (acctRows.length > 0) {
    const acctIds = acctRows.map((a) => a.id);
    const ownerRows = await db
      .select({ accountId: accountOwners.accountId, entityId: accountOwners.entityId })
      .from(accountOwners)
      .where(inArray(accountOwners.accountId, acctIds));
    for (const row of ownerRows) {
      if (row.entityId != null) accountEntityOwner.set(row.accountId, row.entityId);
    }
  }

  if (acctRows.length === 0) {
    return {
      data: {
        clientName: `${client.firstName} ${client.lastName}`.trim(),
        household: {
          totalClassifiedValue: 0,
          totalInvestableValue: 0,
          unallocatedValue: 0,
          byAssetClass: [],
        },
        drift: { benchmarkName: null, rows: [] },
        perAccount: [],
      },
      asOf: new Date(),
      dataVersion: "empty",
    };
  }

  // Index allocations by account id (filter to this client's accounts).
  const accountIds = new Set(acctRows.map((a) => a.id));
  const accountMixByAccountId: Record<string, AssetClassWeight[]> = {};
  for (const row of mixRows) {
    if (!accountIds.has(row.accountId)) continue;
    (accountMixByAccountId[row.accountId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  // Index model portfolio allocations by portfolio id.
  const modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> = {};
  for (const row of portfolioAllocRows) {
    (modelPortfolioAllocationsByPortfolioId[row.modelPortfolioId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  const cashAssetClassId = classRows.find((c) => c.slug === "cash")?.id ?? null;

  const planLite: PlanSettingsLite = {
    growthSourceTaxable: settings.growthSourceTaxable,
    growthSourceCash: settings.growthSourceCash,
    growthSourceRetirement: settings.growthSourceRetirement,
    modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable ?? null,
    modelPortfolioIdCash: settings.modelPortfolioIdCash ?? null,
    modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement ?? null,
  };

  const assetClassLites: AssetClassLite[] = classRows.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    assetType: c.assetType as AssetTypeId,
  }));

  const investableAccounts: InvestableAccount[] = acctRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    value: Number(a.value),
    ownerEntityId: accountEntityOwner.get(a.id) ?? null,
  }));

  const household = computeHouseholdAllocation(
    investableAccounts,
    (acct: AccountLite) =>
      resolveAccountAllocation(
        acct,
        accountMixByAccountId,
        modelPortfolioAllocationsByPortfolioId,
        planLite,
        cashAssetClassId,
      ),
    assetClassLites,
  );

  const portfolioLites = portfolioRows.map((p) => ({ id: p.id, name: p.name }));
  const benchmark = resolveBenchmark(
    settings.selectedBenchmarkPortfolioId ?? null,
    portfolioLites,
    modelPortfolioAllocationsByPortfolioId,
  );

  const nameByClassId: Record<string, string> = {};
  for (const c of classRows) nameByClassId[c.id] = c.name;

  const driftRows = benchmark ? computeDrift(household.byAssetClass, benchmark, nameByClassId) : [];

  // Build per-account allocation breakdown for the by-account CSV.
  const perAccount = acctRows.map((a) => {
    const acctLite: AccountLite = {
      id: a.id,
      category: a.category,
      growthSource: a.growthSource,
      modelPortfolioId: a.modelPortfolioId ?? null,
    };
    const result = resolveAccountAllocation(
      acctLite,
      accountMixByAccountId,
      modelPortfolioAllocationsByPortfolioId,
      planLite,
      cashAssetClassId,
    );
    const allocation =
      "unallocated" in result
        ? ({ unallocated: true } as const)
        : {
            classified: result.classified.map((w) => ({
              classId: w.assetClassId,
              label: nameByClassId[w.assetClassId] ?? w.assetClassId,
              weight: w.weight,
            })),
          };
    return {
      accountId: a.id,
      accountName: a.name,
      value: Number(a.value),
      allocation,
    };
  });

  // Resolve the benchmark's portfolio name from portfolioLites.
  const benchmarkName =
    settings.selectedBenchmarkPortfolioId
      ? (portfolioLites.find((p) => p.id === settings.selectedBenchmarkPortfolioId)?.name ?? null)
      : null;

  const data: InvestmentsData = {
    clientName: `${client.firstName} ${client.lastName}`.trim(),
    household: {
      totalClassifiedValue: household.totalClassifiedValue,
      totalInvestableValue: household.totalInvestableValue,
      unallocatedValue: household.unallocatedValue,
      byAssetClass: household.byAssetClass.map((c) => ({
        classId: c.id,
        label: c.name,
        value: c.value,
        pctOfClassified: c.pctOfClassified,
      })),
    },
    drift: {
      benchmarkName,
      rows: driftRows.map((d) => ({
        classId: d.assetClassId,
        label: d.name,
        currentPct: d.currentPct,
        targetPct: d.targetPct,
        diffPct: d.diffPct,
      })),
    },
    perAccount,
  };

  const dataVersion = createHash("sha1")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);

  return { data, asOf: new Date(), dataVersion };
}

export const investmentsArtifact: ReportArtifact<InvestmentsData, typeof optionsSchema> = {
  id: "investments",
  title: "Investments",
  section: "assets",
  route: "/clients/[id]/assets/investments",
  variants: ["chart", "data", "chart+data", "csv"],
  optionsSchema,
  defaultOptions: { drillDownClasses: [] },

  fetchData: ({ clientId, firmId, opts }) =>
    fetchInvestmentsData(clientId, firmId, opts),

  renderPdf: ({ data, opts, variant, charts }) => {
    const showCharts = variant === "chart" || variant === "chart+data";
    const showData = variant === "data" || variant === "chart+data";
    const donut = charts.find((c) => c.id === "donut");
    const drift = charts.find((c) => c.id === "drift");

    const fmtMoney = (n: number) =>
      n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

    // When drillDownClasses is set, filter per-account rows to only accounts
    // that hold at least one of the requested classes. Unallocated accounts are
    // excluded because they carry no class breakdown.
    const filteredAccounts =
      opts.drillDownClasses.length === 0
        ? data.perAccount
        : data.perAccount.filter((a) => {
            if ("unallocated" in a.allocation) return false;
            return a.allocation.classified.some((c) =>
              opts.drillDownClasses.includes(c.classId),
            );
          });

    const styles = StyleSheet.create({
      sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 12, marginBottom: 4 },
    });

    return (
      <View>
        {showCharts && donut && <ChartImage chart={donut} maxWidth={420} />}
        {showCharts && drift && <ChartImage chart={drift} maxWidth={480} />}

        {showData && (
          <>
            <Text style={styles.sectionTitle}>Household Allocation</Text>
            <DataTable
              columns={[
                {
                  header: "Asset Class",
                  accessor: (r: typeof data.household.byAssetClass[number]) => r.label,
                },
                {
                  header: "Value",
                  accessor: (r: typeof data.household.byAssetClass[number]) =>
                    fmtMoney(r.value),
                  align: "right",
                },
                {
                  header: "% Classified",
                  accessor: (r: typeof data.household.byAssetClass[number]) =>
                    fmtPct(r.pctOfClassified),
                  align: "right",
                },
              ]}
              rows={data.household.byAssetClass}
              footerRow={{
                classId: "_total",
                label: "Total Classified",
                value: data.household.totalClassifiedValue,
                pctOfClassified: 1,
              }}
            />

            {data.drift.benchmarkName ? (
              <>
                <Text style={styles.sectionTitle}>
                  Drift vs {data.drift.benchmarkName}
                </Text>
                <DataTable
                  columns={[
                    {
                      header: "Asset Class",
                      accessor: (r: typeof data.drift.rows[number]) => r.label,
                    },
                    {
                      header: "Current",
                      accessor: (r: typeof data.drift.rows[number]) =>
                        fmtPct(r.currentPct),
                      align: "right",
                    },
                    {
                      header: "Target",
                      accessor: (r: typeof data.drift.rows[number]) =>
                        fmtPct(r.targetPct),
                      align: "right",
                    },
                    {
                      header: "Diff",
                      accessor: (r: typeof data.drift.rows[number]) =>
                        fmtPct(r.diffPct),
                      align: "right",
                    },
                  ]}
                  rows={data.drift.rows}
                />
              </>
            ) : (
              <Text style={styles.sectionTitle}>Drift: no benchmark selected</Text>
            )}

            {filteredAccounts.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Holdings by Account</Text>
                <DataTable
                  columns={[
                    {
                      header: "Account",
                      accessor: (r: typeof filteredAccounts[number]) => r.accountName,
                    },
                    {
                      header: "Value",
                      accessor: (r: typeof filteredAccounts[number]) =>
                        fmtMoney(r.value),
                      align: "right",
                    },
                  ]}
                  rows={filteredAccounts}
                />
              </>
            )}
          </>
        )}
      </View>
    );
  },

  toCsv: (data) => {
    const allocationRows: string[][] = [
      ["Asset Class", "Value", "% of Classified"],
      ...data.household.byAssetClass.map((c) => [
        c.label,
        String(c.value),
        (c.pctOfClassified * 100).toFixed(2) + "%",
      ]),
      ["Total Classified", String(data.household.totalClassifiedValue), "100.00%"],
    ];

    const driftRows: string[][] = [
      ["Asset Class", "Current %", "Target %", "Diff (Target − Current)"],
      ...(data.drift.rows.length === 0
        ? [["(no benchmark selected)", "", "", ""]]
        : data.drift.rows.map((d) => [
            d.label,
            (d.currentPct * 100).toFixed(2) + "%",
            (d.targetPct * 100).toFixed(2) + "%",
            (d.diffPct * 100).toFixed(2) + "%",
          ])),
    ];

    const accountRows: string[][] = [
      ["Account", "Value", "Asset Class", "Weight"],
      ...data.perAccount.flatMap((a) => {
        if ("unallocated" in a.allocation) {
          return [[a.accountName, String(a.value), "(unallocated)", ""]];
        }
        return a.allocation.classified.map((c) => [
          a.accountName,
          String(a.value),
          c.label,
          (c.weight * 100).toFixed(2) + "%",
        ]);
      }),
    ];

    return [
      { name: "investments-allocation.csv", contents: serializeCsv(allocationRows) },
      { name: "investments-drift.csv", contents: serializeCsv(driftRows) },
      { name: "investments-by-account.csv", contents: serializeCsv(accountRows) },
    ];
  },
};
