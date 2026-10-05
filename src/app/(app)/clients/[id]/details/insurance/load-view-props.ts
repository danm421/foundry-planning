import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  clientCmaOverrides,
  planSettings,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";
import { computeScheduleYearRange } from "@/lib/insurance-policies/schedule-years";
import { resolveInflationRate } from "@/lib/inflation";
import {
  type InsurancePanelProps,
  type InsurancePanelAccount,
  type InsurancePanelFamilyMember,
  type InsurancePanelEntity,
  type InsurancePanelExternal,
  type InsurancePanelModelPortfolio,
} from "@/components/insurance-panel";
import type { DisabilityPanelProps } from "@/components/disability-panel";
import { resolveCoveredEarnings } from "@/engine/disability-benefits";
import type { DisabilityPolicy } from "@/engine/types";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadActiveChangesOfKind } from "@/lib/scenario/changes";
import { ownerRefFromOwners } from "@/lib/insurance-policies/owner-ref";
import { treeMilestones } from "@/lib/milestones";

export type InsuranceViewPropsResult =
  | { status: "ok"; props: InsurancePanelProps; disabilityProps: DisabilityPanelProps }
  | { status: "no-base-case" };

/**
 * Everything the Insurance page renders from, for one client and scenario.
 * Shared by the Details page and the Solver's change editor so both open the
 * same dialogs off the same rows. Throws `notFound()` for an unknown client.
 */
export async function loadInsuranceViewProps(
  clientId: string,
  scenarioParam: string | undefined,
): Promise<InsuranceViewPropsResult> {
  // The body below moved here verbatim from `InsuranceContent`, which named it `id`.
  const id = clientId;
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
    return { status: "no-base-case" };
  }

  const [
    portfolioRows,
    allocationRows,
    assetClassRows,
    settingsRows,
    { effectiveTree, resolutionContext },
  ] = await Promise.all([
    db
      .select({ id: modelPortfolios.id, name: modelPortfolios.name })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId))
      .orderBy(asc(modelPortfolios.name)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
  ]);

  const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));
  const blendedByPortfolio = new Map<string, number>();
  for (const p of portfolioRows) {
    const allocs = allocationRows.filter((a) => a.modelPortfolioId === p.id);
    let blended = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (ac) blended += parseFloat(alloc.weight) * parseFloat(ac.geometricReturn);
    }
    blendedByPortfolio.set(p.id, blended);
  }

  const settings = settingsRows[0];
  const firmInflationAc = assetClassRows.find((ac) => ac.slug === "inflation") ?? null;
  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings?.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(
        eq(clientCmaOverrides.clientId, id),
        eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id),
      ));
    if (override) clientInflationOverride = override;
  }
  // In a scenario the inflation rate is the SCENARIO's: its growth edits are
  // folded onto the tree, not onto the base settings row.
  const inScenario = !!scenarioParam && scenarioParam !== "base";
  const resolvedInflationRate =
    inScenario && resolutionContext
      ? resolutionContext.resolvedInflationRate
      : resolveInflationRate(
          {
            inflationRateSource: settings?.inflationRateSource ?? "custom",
            inflationRate: settings?.inflationRate ?? "0",
          },
          firmInflationAc ? { geometricReturn: firmInflationAc.geometricReturn } : null,
          clientInflationOverride,
        );

  const accountRows = [...effectiveTree.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const lifeAccountIds = accountRows
    .filter((a) => a.category === "life_insurance")
    .map((a) => a.id);
  // The tree carries each policy — scenario-added and scenario-edited ones
  // included. A policy that names a post-payout model portfolio carries that
  // portfolio's RESOLVED rate in the tree (the engine reads only the resolved
  // value), which would pre-fill the dialog's custom-rate box with the
  // portfolio's rate. The raw custom rate is what the policy was saved with: the
  // latest scenario change that set one (adds are resolved only at load, edits
  // are stored as sent), else the base row.
  const baseRawPolicies = await loadPoliciesByAccountIds(lifeAccountIds);
  const scenarioRawRate = new Map<string, number>();
  if (inScenario) {
    const changes = [...(await loadActiveChangesOfKind(scenarioParam, "account"))].sort(
      (x, y) => x.orderIndex - y.orderIndex,
    );
    for (const c of changes) {
      // An add's payload is the entity; an edit's is a field diff whose `to` is
      // the value the scenario sets.
      const li = (c.payload as { lifeInsurance?: unknown } | null)?.lifeInsurance;
      const policy = c.opType === "edit" ? (li as { to?: unknown } | undefined)?.to : li;
      const rate = (policy as { postPayoutGrowthRate?: unknown } | null | undefined)?.postPayoutGrowthRate;
      if (c.opType !== "remove" && typeof rate === "number") scenarioRawRate.set(c.targetId, rate);
    }
  }
  const policies: InsurancePanelProps["policies"] = {};
  for (const a of accountRows) {
    if (a.category !== "life_insurance" || !a.lifeInsurance) continue;
    const policy = a.lifeInsurance;
    policies[a.id] = {
      ...policy,
      postPayoutGrowthRate: policy.postPayoutModelPortfolioId
        ? (scenarioRawRate.get(a.id) ??
          baseRawPolicies[a.id]?.postPayoutGrowthRate ??
          policy.postPayoutGrowthRate)
        : policy.postPayoutGrowthRate,
    };
  }

  const clientFmId =
    (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId =
    (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;

  const accts: InsurancePanelAccount[] = accountRows.map((a) => {
    const ref = ownerRefFromOwners(a.owners, { clientFmId, spouseFmId });
    // Defensive fallback: if the legacy / synthetic shape isn't a known
    // OwnerRef, render as joint so the panel still displays. (This should
    // never fire for policies created through this editor — only for
    // legacy multi-owner fixtures.)
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      subType: (a.subType ?? null) as InsurancePanelAccount["subType"],
      ownerRef: ref ?? { kind: "joint" },
      insuredPerson: a.insuredPerson ?? null,
      value: String(a.value),
      activationYear: a.activationYear ?? null,
      activationYearRef: a.activationYearRef ?? null,
      beneficiaries: a.beneficiaries,
    };
  });
  const fams: InsurancePanelFamilyMember[] = [...(effectiveTree.familyMembers ?? [])]
    .sort((x, y) => x.firstName.localeCompare(y.firstName))
    .map((f) => ({
      id: f.id,
      firstName: f.firstName,
      lastName: f.lastName ?? null,
      relationship: f.relationship,
      role: f.role,
      dateOfBirth: f.dateOfBirth ?? null,
      // The tree carries no free-text notes, and no insurance surface shows them.
      notes: null,
    }));
  const ents: InsurancePanelEntity[] = [...(effectiveTree.entities ?? [])]
    .sort((x, y) => (x.name ?? "").localeCompare(y.name ?? ""))
    .map((e) => ({
      id: e.id,
      name: e.name ?? "",
      entityType: e.entityType ?? "trust",
      crummeyPowers: e.crummeyPowers ?? false,
    }));
  const exts: InsurancePanelExternal[] = [...(effectiveTree.externalBeneficiaries ?? [])]
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      notes: null,
    }));
  const portfolios: InsurancePanelModelPortfolio[] = portfolioRows.map((p) => ({
    id: p.id,
    name: p.name,
    blendedReturn: blendedByPortfolio.get(p.id) ?? 0,
  }));

  // Policy schedule grid range: plan start year → household second-to-die year.
  const { startYear: scheduleStartYear, endYear: scheduleEndYear } =
    computeScheduleYearRange({
      clientDob: effectiveTree.client.dateOfBirth,
      lifeExpectancy: effectiveTree.client.lifeExpectancy ?? 95,
      spouseDob: effectiveTree.client.spouseDob ?? null,
      spouseLifeExpectancy: effectiveTree.client.spouseLifeExpectancy ?? null,
      planStartYear: effectiveTree.planSettings.planStartYear,
      planEndYear: effectiveTree.planSettings.planEndYear,
    });

  // Milestones power the policy dialog's activation-year picker.
  const planStartYear = effectiveTree.planSettings.planStartYear;
  const planEndYear = effectiveTree.planSettings.planEndYear;
  const milestones = treeMilestones(effectiveTree);

  // What a policy insures this year, in SALARY mode. This calls the engine's
  // `resolveCoveredEarnings` itself rather than re-typing its `computeIncome`
  // predicate, so a change to what the engine counts as covered pay reaches this
  // screen automatically instead of drifting from it. `effectiveTree.incomes` is
  // PRE-CLIP — `loadEffectiveTree` never applies the disability event — which is
  // the input that function requires.
  //
  // Only `insured` and `coveredEarningsMode` are read on that branch, so the
  // stand-in below carries nothing else meaningful. Manual mode is resolved in
  // the browser, off the LIVE form, by the same engine function.
  const currentYear = new Date().getFullYear();
  const salaryModeProbe = (person: "client" | "spouse"): DisabilityPolicy => ({
    id: `covered-earnings-${person}`,
    name: "",
    insured: person,
    coveredEarningsMode: "salary",
    coveredEarningsAmount: null,
    shortTerm: null,
    longTerm: null,
    benefitTaxable: true,
    colaRate: 0,
    annualPremium: 0,
    premiumPayer: "employer",
  });
  const salaryFor = (person: "client" | "spouse") =>
    resolveCoveredEarnings(salaryModeProbe(person), {
      incomes: effectiveTree.incomes,
      client: effectiveTree.client,
      startYear: currentYear,
      planStartYear,
      inflationRate: resolvedInflationRate,
    });

  return {
    status: "ok",
    props: {
      clientId: id,
      clientFirstName: effectiveTree.client.firstName,
      spouseFirstName: effectiveTree.client.spouseName ?? null,
      accounts: accts,
      policies,
      entities: ents,
      familyMembers: fams,
      externalBeneficiaries: exts,
      modelPortfolios: portfolios,
      resolvedInflationRate,
      scheduleStartYear,
      scheduleEndYear,
      milestones,
    },
    disabilityProps: {
      clientId: id,
      policies: effectiveTree.disabilityPolicies ?? [],
      clientFirstName: effectiveTree.client.firstName,
      spouseFirstName: effectiveTree.client.spouseName ?? null,
      currentSalaryByPerson: { client: salaryFor("client"), spouse: salaryFor("spouse") },
      currentYear,
      planStartYear,
      inflationRate: resolvedInflationRate,
      planEndYear,
      client: effectiveTree.client,
    },
  };
}
