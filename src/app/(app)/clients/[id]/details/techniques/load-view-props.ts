import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  modelPortfolios,
  familyMembers,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import type { TechniquesViewProps } from "@/components/techniques-view";
import { buildBusinessSaleOptions } from "@/lib/techniques/sell-source-options";
import { treeMilestones } from "@/lib/milestones";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingFamilyMember } from "@/engine/ownership";

export type TechniquesViewPropsResult =
  | { status: "ok"; props: TechniquesViewProps }
  | { status: "no-base-case" };

/**
 * Everything `TechniquesView` renders from, for one client and scenario.
 * Shared by the Details page and the Solver's change editor so both open the
 * same dialogs off the same rows. Throws `notFound()` for an unknown client or
 * a primary contact without a date of birth.
 */
export async function loadTechniquesViewProps(
  clientId: string,
  scenarioParam: string | undefined,
): Promise<TechniquesViewPropsResult> {
  // The body below moved here verbatim from `TechniquesContent`, which named it `id`.
  const id = clientId;
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
  if (!primaryContact?.dateOfBirth) notFound();

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return { status: "no-base-case" };
  }

  const [loadedTree, modelPortfolioRows, familyMemberRows] = await Promise.all([
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
  const relocationRows = [...(effectiveTree.relocations ?? [])].sort((a, b) => a.year - b.year);
  const liabilityRows = [...effectiveTree.liabilities].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const milestones = treeMilestones(effectiveTree);

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

  // Scenario overlays can store a decimal as a string.
  const toNumberOrNull = (v: number | string | null | undefined) => (v == null ? null : Number(v));
  const reinvestmentProps = reinvestmentRows.map((r) => ({
    id: r.id,
    name: r.name,
    // The picks alone: the form shows the groups as groups. `accountIds` is the
    // union with the groups' members, so it stands in only for a reinvestment
    // that carries no picks.
    pickedAccountIds: r.pickedAccountIds ?? r.accountIds,
    groupKeys: r.groupKeys ?? [],
    year: r.year,
    yearRef: r.yearRef ?? null,
    targetType: r.targetType ?? "model_portfolio",
    realizeTaxesOnSwitch: r.realizeTaxesOnSwitch,
    modelPortfolioId: r.modelPortfolioId ?? null,
    customGrowthRate: toNumberOrNull(r.customGrowthRate),
    customPctOrdinaryIncome: toNumberOrNull(r.customPctOrdinaryIncome),
    customPctLtCapitalGains: toNumberOrNull(r.customPctLtCapitalGains),
    customPctQualifiedDividends: toNumberOrNull(r.customPctQualifiedDividends),
    customPctTaxExempt: toNumberOrNull(r.customPctTaxExempt),
  }));

  const transactionProps = transactionRows.map((tx) => ({
    id: tx.id,
    name: tx.name,
    type: tx.type as "buy" | "sell",
    year: tx.year,
    accountId: tx.accountId ?? null,
    purchaseTransactionId: tx.purchaseTransactionId ?? null,
    businessAccountId: tx.businessAccountId ?? null,
    bundleId: tx.bundleId ?? null,
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
    annualPropertyTax: tx.annualPropertyTax == null ? null : String(tx.annualPropertyTax),
    propertyTaxGrowthRate: tx.propertyTaxGrowthRate == null ? null : String(tx.propertyTaxGrowthRate),
    propertyTaxGrowthSource: tx.propertyTaxGrowthSource ?? null,
  }));

  const relocationProps = relocationRows.map((r) => ({
    id: r.id,
    name: r.name,
    year: r.year,
    destinationState: r.destinationState,
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
    irmaaCapTier: c.irmaaCapTier ?? null,
  }));

  const accountOptions = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    subType: a.subType,
    ownerFamilyMemberId: controllingFamilyMember(a),
    value: Number(a.value ?? 0),
    isDefaultChecking: a.isDefaultChecking === true,
    parentAccountId: a.parentAccountId ?? null,
    isEntityOwned: (a.owners ?? []).some((o) => o.kind === "entity"),
    inheritedDeathYear: a.inheritedDeathYear ?? null,
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

  const businessOptions = buildBusinessSaleOptions(
    accountRows,
    liabilityRows,
    (id) => familyMemberNameById.get(id) ?? id,
  );

  return {
    status: "ok",
    props: {
      clientId: id,
      transfers: transferProps,
      reinvestments: reinvestmentProps,
      relocations: relocationProps,
      assetTransactions: transactionProps,
      rothConversions: rothConversionProps,
      accounts: accountOptions,
      liabilities: liabilityOptions,
      businesses: businessOptions,
      modelPortfolios: modelPortfolioOptions,
      milestones,
      clientFirstName: effectiveTree.client.firstName,
      spouseFirstName: effectiveTree.client.spouseName ?? undefined,
    },
  };
}
