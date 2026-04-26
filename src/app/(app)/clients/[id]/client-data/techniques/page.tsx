import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import TechniquesView from "@/components/techniques-view";
import { buildClientMilestones } from "@/lib/milestones";
import ClientDataPageShell from "@/components/client-data-page-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function TechniquesPage({ params, searchParams }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
          No base case scenario found.
        </div>
      </ClientDataPageShell>
    );
  }

  const [planSettingsRows, { effectiveTree }] = await Promise.all([
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    loadEffectiveTree(id, firmId, sp.scenario ?? "base", {}),
  ]);

  const accountRows = [...effectiveTree.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const transferRows = [...(effectiveTree.transfers ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const transactionRows = [...(effectiveTree.assetTransactions ?? [])].sort(
    (a, b) => a.year - b.year,
  );
  const liabilityRows = [...effectiveTree.liabilities].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const settings = planSettingsRows[0];
  const planStartYear = settings?.planStartYear ?? new Date().getFullYear();
  const planEndYear = settings?.planEndYear ?? new Date().getFullYear() + 30;
  const milestones = buildClientMilestones(client, planStartYear, planEndYear);

  const transferProps = transferRows.map((t) => ({
    id: t.id,
    name: t.name,
    sourceAccountId: t.sourceAccountId,
    targetAccountId: t.targetAccountId,
    amount: String(t.amount),
    mode: t.mode as "one_time" | "recurring" | "scheduled",
    startYear: t.startYear,
    startYearRef: t.startYearRef ?? null,
    endYear: t.endYear ?? null,
    endYearRef: t.endYearRef ?? null,
    growthRate: String(t.growthRate),
    schedules: t.schedules.map((s, idx) => ({
      id: `${t.id}-${idx}`,
      year: s.year,
      amount: String(s.amount),
    })),
  }));

  const transactionProps = transactionRows.map((tx) => ({
    id: tx.id,
    name: tx.name,
    type: tx.type as "buy" | "sell",
    year: tx.year,
    accountId: tx.accountId ?? null,
    overrideSaleValue: tx.overrideSaleValue == null ? null : String(tx.overrideSaleValue),
    overrideBasis: tx.overrideBasis == null ? null : String(tx.overrideBasis),
    transactionCostPct: tx.transactionCostPct == null ? null : String(tx.transactionCostPct),
    transactionCostFlat: tx.transactionCostFlat == null ? null : String(tx.transactionCostFlat),
    proceedsAccountId: tx.proceedsAccountId ?? null,
    qualifiesForHomeSaleExclusion: tx.qualifiesForHomeSaleExclusion ?? false,
    assetName: tx.assetName ?? null,
    assetCategory: tx.assetCategory ?? null,
    assetSubType: tx.assetSubType ?? null,
    purchasePrice: tx.purchasePrice == null ? null : String(tx.purchasePrice),
    growthRate: tx.growthRate == null ? null : String(tx.growthRate),
    basis: tx.basis == null ? null : String(tx.basis),
    fundingAccountId: tx.fundingAccountId ?? null,
    mortgageAmount: tx.mortgageAmount == null ? null : String(tx.mortgageAmount),
    mortgageRate: tx.mortgageRate == null ? null : String(tx.mortgageRate),
    mortgageTermMonths: tx.mortgageTermMonths ?? null,
  }));

  const accountOptions = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    subType: a.subType,
  }));

  const liabilityOptions = liabilityRows.map((l) => ({
    id: l.id,
    name: l.name,
    linkedPropertyId: l.linkedPropertyId ?? null,
    balance: String(l.balance),
  }));

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <TechniquesView
        clientId={id}
        transfers={transferProps}
        assetTransactions={transactionProps}
        accounts={accountOptions}
        liabilities={liabilityOptions}
        milestones={milestones}
        clientFirstName={client.firstName}
        spouseFirstName={client.spouseName ?? undefined}
      />
    </ClientDataPageShell>
  );
}
