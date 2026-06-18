import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  modelPortfolios,
  familyMembers,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import TechniquesView from "@/components/techniques-view";
import type { BusinessSaleOption } from "@/components/forms/add-asset-transaction-form";
import { buildClientMilestones } from "@/lib/milestones";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingFamilyMember } from "@/engine/ownership";

interface TechniquesContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function TechniquesContent({ clientId: id, scenarioParam }: TechniquesContentProps) {
  const firmId = await getOrgId();

  const [clientRow] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!clientRow) notFound();

  // CRM contacts — sole identity source for milestone math.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact?.dateOfBirth) notFound();
  const client = {
    ...clientRow,
    dateOfBirth: primaryContact.dateOfBirth,
    spouseDob: spouseContact?.dateOfBirth ?? null,
  };

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  const [planSettingsRows, loadedTree, modelPortfolioRows, familyMemberRows] = await Promise.all([
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

  const { effectiveTree } = loadedTree;

  // Blended growth rate per model portfolio — same resolver the projection uses
  // (asset-class geometric returns weighted by allocation, with client CMA
  // overrides applied), so the reinvestment dropdown shows the rate it will
  // actually apply on switch.
  const growthResolver = loadedTree.resolutionContext?.resolver;
  const modelPortfolioOptions = modelPortfolioRows.map((p) => ({
    ...p,
    growthRate: growthResolver?.resolvePortfolio(p.id).geoReturn,
  }));

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
    groupKeys: r.groupKeys ?? [],
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
    businessAccountId: tx.businessAccountId ?? null,
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
    ownerFamilyMemberId: controllingFamilyMember(a),
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

  // Build the business options the asset-transaction form needs to drive
  // its business-sale subform: top-level business accounts (parentAccountId
  // is null) with their child accounts/liabilities and family-member owners.
  const BUSINESS_TYPE_LABELS: Record<string, string> = {
    sole_prop: "Sole prop",
    partnership: "Partnership",
    s_corp: "S-Corp",
    c_corp: "C-Corp",
    llc: "LLC",
    other: "Other",
  };
  const businessOptions: BusinessSaleOption[] = accountRows
    .filter(
      (a) => a.category === "business" && a.parentAccountId == null,
    )
    .map((b) => {
      const childAccounts = accountRows
        .filter((a) => a.parentAccountId === b.id)
        .map((a) => ({
          id: a.id,
          name: a.name,
          currentValue: Number(a.value ?? 0),
        }));
      const childLiabilities = liabilityRows
        .filter((l) => l.parentAccountId === b.id)
        .map((l) => ({
          id: l.id,
          name: l.name,
          currentBalance: Number(l.balance ?? 0),
        }));
      return {
        id: b.id,
        name: b.name,
        businessTypeLabel:
          BUSINESS_TYPE_LABELS[b.businessType ?? "other"] ?? "Business",
        value: Number(b.value ?? 0),
        basis: Number(b.basis ?? 0),
        owners: (b.owners ?? [])
          .filter((o) => o.kind === "family_member")
          .map((o) => ({
            familyMemberId: o.familyMemberId,
            familyMemberName:
              familyMemberNameById.get(o.familyMemberId) ?? o.familyMemberId,
            percent: o.percent,
          })),
        childAccounts,
        childLiabilities,
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
      businesses={businessOptions}
      modelPortfolios={modelPortfolioOptions}
      milestones={milestones}
      clientFirstName={effectiveTree.client.firstName}
      spouseFirstName={effectiveTree.client.spouseName ?? undefined}
    />
  );
}
