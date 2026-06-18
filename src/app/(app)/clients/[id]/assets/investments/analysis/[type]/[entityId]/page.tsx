import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";
import { loadAnalysisDataset } from "@/lib/investments/load-analysis-dataset";
import { buildBreakdown, buildWhereHeld } from "@/lib/investments/analysis-detail";
import PortfolioAnalysisDetail, { type DetailMemberAccount } from "../../../portfolio-analysis-detail";

interface PageProps {
  params: Promise<{ id: string; type: string; entityId: string }>;
  searchParams: Promise<{ group?: string; scenario?: string }>;
}

export default async function PortfolioAnalysisDetailPage({ params, searchParams }: PageProps) {
  const firmId = await getOrgId();
  const { id: clientId, type, entityId } = await params;
  const { group, scenario } = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const dataset = await loadAnalysisDataset(clientId, firmId);
  if (!dataset) notFound();

  const key = `${type}:${entityId}`;
  const row = dataset.rows.find((r) => r.key === key);
  if (!row) notFound();

  const breakdown = buildBreakdown(row.weights, row.value, dataset.assetClasses);

  // Constituent accounts for category / custom_group rows.
  let members: DetailMemberAccount[] | null = null;
  if (row.type === "category" || row.type === "custom_group") {
    const memberIds =
      row.type === "category" ? dataset.categoryMembers[row.id] ?? [] : dataset.customGroupMembers[row.id] ?? [];
    members = memberIds
      .map((aid) => {
        const a = dataset.accountsById[aid];
        if (!a) return null;
        const top = [...a.weights].sort((x, y) => y.weight - x.weight)[0];
        const topClass = top ? dataset.assetClasses.find((c) => c.id === top.assetClassId)?.name ?? null : null;
        return { id: aid, name: a.name, value: a.value, topClass };
      })
      .filter((m): m is DetailMemberAccount => m !== null)
      .sort((x, y) => y.value - x.value);
  }

  // "Where held" + tax for a single asset class.
  const isAssetClass = row.type === "asset_class";
  const whereHeld = isAssetClass
    ? buildWhereHeld(row.id, dataset.accountsById, dataset.categoryMembers, dataset.customGroupMembers)
    : null;
  const tax = isAssetClass ? dataset.assetClasses.find((c) => c.id === row.id)?.tax ?? null : null;

  // Mini scatter: plot the underlying asset classes (or, for an asset_class
  // drill, just the class itself).
  const breakdownIds = new Set(breakdown.map((b) => b.assetClassId));
  const scatterRows = isAssetClass
    ? dataset.rows.filter((r) => r.key === key)
    : dataset.rows.filter((r) => r.type === "asset_class" && breakdownIds.has(r.id));

  const qs = new URLSearchParams({ view: "analysis" });
  if (group) qs.set("group", group);
  if (scenario) qs.set("scenario", scenario);
  const backHref = `/clients/${clientId}/assets/investments?${qs.toString()}`;

  return (
    <ScenarioDrawerShell clientId={clientId} scenarioId={scenario}>
      <PortfolioAnalysisDetail
        row={row}
        breakdown={breakdown}
        members={members}
        whereHeld={whereHeld}
        scatterRows={scatterRows}
        tax={tax}
        backHref={backHref}
      />
    </ScenarioDrawerShell>
  );
}
