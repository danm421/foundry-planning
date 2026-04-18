import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  transfers,
  transferSchedules,
  assetTransactions,
  liabilities,
  planSettings,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import TechniquesView from "@/components/techniques-view";
import { buildClientMilestones } from "@/lib/milestones";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TechniquesPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

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
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No base case scenario found.
      </div>
    );
  }

  const [accountRows, transferRows, scheduleRows, transactionRows, liabilityRows, planSettingsRows] =
    await Promise.all([
      db
        .select()
        .from(accounts)
        .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id)))
        .orderBy(asc(accounts.name)),
      db
        .select()
        .from(transfers)
        .where(and(eq(transfers.clientId, id), eq(transfers.scenarioId, scenario.id)))
        .orderBy(asc(transfers.name)),
      db
        .select()
        .from(transferSchedules)
        .orderBy(asc(transferSchedules.year)),
      db
        .select()
        .from(assetTransactions)
        .where(and(eq(assetTransactions.clientId, id), eq(assetTransactions.scenarioId, scenario.id)))
        .orderBy(asc(assetTransactions.year)),
      db
        .select()
        .from(liabilities)
        .where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id)))
        .orderBy(asc(liabilities.name)),
      db
        .select()
        .from(planSettings)
        .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    ]);

  const settings = planSettingsRows[0];
  const planStartYear = settings?.planStartYear ?? new Date().getFullYear();
  const planEndYear = settings?.planEndYear ?? new Date().getFullYear() + 30;
  const milestones = buildClientMilestones(client, planStartYear, planEndYear);

  // Attach schedules to their parent transfers
  const schedulesByTransfer = new Map<string, { id: string; year: number; amount: string }[]>();
  for (const s of scheduleRows) {
    const list = schedulesByTransfer.get(s.transferId) ?? [];
    list.push({ id: s.id, year: s.year, amount: String(s.amount) });
    schedulesByTransfer.set(s.transferId, list);
  }

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
    schedules: schedulesByTransfer.get(t.id) ?? [],
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
  );
}
