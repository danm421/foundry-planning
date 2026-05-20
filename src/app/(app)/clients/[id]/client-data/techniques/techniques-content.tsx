import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  modelPortfolios,
  familyMembers,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import TechniquesView from "@/components/techniques-view";
import type { EntityOption } from "@/components/techniques-view";
import { buildClientMilestones } from "@/lib/milestones";
import { loadEffectiveTree } from "@/lib/scenario/loader";

interface TechniquesContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function TechniquesContent({ clientId: id, scenarioParam }: TechniquesContentProps) {
  const firmId = await getOrgId();

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
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No base case scenario found.
      </div>
    );
  }

  const [planSettingsRows, { effectiveTree }, modelPortfolioRows, familyMemberRows] = await Promise.all([
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
    db
      .select({ id: modelPortfolios.id, name: modelPortfolios.name })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId)),
    db
      .select({
        id: familyMembers.id,
        firstName: familyMembers.firstName,
        lastName: familyMembers.lastName,
      })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id)),
  ]);

  const accountRows = [...effectiveTree.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const transferRows = [...(effectiveTree.transfers ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const reinvestmentRows = [...(effectiveTree.reinvestments ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const rothConversionRows = [...(effectiveTree.rothConversions ?? [])].sort((a, b) =>
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

  const reinvestmentProps = reinvestmentRows.map((r) => ({
    id: r.id,
    name: r.name,
    accountIds: r.accountIds,
    year: r.year,
    yearRef: r.yearRef ?? null,
    targetType: r.targetType ?? "model_portfolio",
    realizeTaxesOnSwitch: r.realizeTaxesOnSwitch,
  }));

  const transactionProps = transactionRows.map((tx) => ({
    id: tx.id,
    name: tx.name,
    type: tx.type as "buy" | "sell",
    year: tx.year,
    accountId: tx.accountId ?? null,
    purchaseTransactionId: tx.purchaseTransactionId ?? null,
    entityId: tx.entityId ?? null,
    fractionSold: tx.fractionSold == null ? null : String(tx.fractionSold),
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

  const rothConversionProps = rothConversionRows.map((c) => ({
    id: c.id,
    name: c.name,
    destinationAccountId: c.destinationAccountId,
    sourceAccountIds: c.sourceAccountIds,
    conversionType: c.conversionType,
    fixedAmount: String(c.fixedAmount),
    fillUpBracket: c.fillUpBracket == null ? null : String(c.fillUpBracket),
    startYear: c.startYear,
    startYearRef: c.startYearRef ?? null,
    endYear: c.endYear ?? null,
    endYearRef: c.endYearRef ?? null,
    indexingRate: String(c.indexingRate),
    inflationStartYear: c.inflationStartYear ?? null,
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

  const familyMemberNameById = new Map(
    familyMemberRows.map((fm) => [
      fm.id,
      [fm.firstName, fm.lastName].filter(Boolean).join(" "),
    ]),
  );

  // Build the entity options the asset-transaction form needs to drive its
  // entity-sale subform: only sellable business entities, with owners and
  // cascaded account/liability previews assembled from effectiveTree owner
  // arrays. Trusts are filtered out so they never appear in the dropdown.
  const entityOptions: EntityOption[] = (effectiveTree.entities ?? [])
    .filter(
      (
        e,
      ): e is typeof e & {
        name: string;
        entityType: NonNullable<typeof e.entityType>;
      } => !!e.name && !!e.entityType && e.entityType !== "trust",
    )
    .map((e) => {
      const ownedAccounts = accountRows
        .map((a) => {
          const row = a.owners?.find(
            (o) => o.kind === "entity" && o.entityId === e.id,
          );
          if (!row || row.kind !== "entity") return null;
          return {
            id: a.id,
            name: a.name,
            entityPercent: row.percent,
            currentValue: Number(a.value ?? 0),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);

      const ownedLiabilities = liabilityRows
        .map((l) => {
          const row = l.owners?.find(
            (o) => o.kind === "entity" && o.entityId === e.id,
          );
          if (!row || row.kind !== "entity") return null;
          return {
            id: l.id,
            name: l.name,
            entityPercent: row.percent,
            currentBalance: Number(l.balance ?? 0),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);

      return {
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        value: Number(e.value ?? 0),
        basis: Number(e.basis ?? 0),
        owners: (e.owners ?? []).map((o) => ({
          familyMemberId: o.familyMemberId,
          familyMemberName:
            familyMemberNameById.get(o.familyMemberId) ?? o.familyMemberId,
          percent: o.percent,
        })),
        ownedAccounts,
        ownedLiabilities,
      };
    });

  return (
    <TechniquesView
      clientId={id}
      transfers={transferProps}
      reinvestments={reinvestmentProps}
      assetTransactions={transactionProps}
      rothConversions={rothConversionProps}
      accounts={accountOptions}
      liabilities={liabilityOptions}
      entities={entityOptions}
      modelPortfolios={modelPortfolioRows}
      milestones={milestones}
      clientFirstName={client.firstName}
      spouseFirstName={client.spouseName ?? undefined}
    />
  );
}
