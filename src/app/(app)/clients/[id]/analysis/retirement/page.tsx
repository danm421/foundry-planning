import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { deriveRetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import { buildHouseholdName } from "@/lib/crm/household-name";
import RetirementAnalysisContent from "./retirement-analysis-content";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function RetirementAnalysisPage({
  params,
  searchParams,
}: PageProps) {
  const firmId = await requireOrgId();
  const { id: clientId } = await params;
  const sp = await searchParams;
  const source: string = sp.scenario ?? "base";

  // Firm-scoped client lookup + CRM contacts in one query pass.
  const [clientRow] = await db
    .select({
      id: clients.id,
      crmHouseholdId: clients.crmHouseholdId,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!clientRow) notFound();

  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));

  const primary = contactRows.find((c) => c.role === "primary");
  const spouse = contactRows.find((c) => c.role === "spouse");
  if (!primary) notFound();

  const clientNames = buildHouseholdName({
    firstName: primary.firstName,
    lastName: primary.lastName,
    spouseFirstName: spouse?.firstName ?? null,
    spouseLastName: spouse?.lastName ?? null,
  });

  // As-of label — server-side date; safe in a server component.
  const now = new Date();
  const asOfLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  // Load projection data.
  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, source, {});
  const currentYears = runProjection(effectiveTree);
  const currentSummary = deriveRetirementSummary(currentYears);

  // Firm model portfolios + blended returns for the min-savings growth picker.
  const [portfolioRows, allocationRows, assetClassRows] = await Promise.all([
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
  ]);
  const acReturnById = new Map(
    assetClassRows.map((ac) => [ac.id, parseFloat(ac.geometricReturn)]),
  );
  const modelPortfolioOptions = portfolioRows.map((p) => {
    let blendedReturn = 0;
    for (const alloc of allocationRows) {
      if (alloc.modelPortfolioId !== p.id) continue;
      blendedReturn += parseFloat(alloc.weight) * (acReturnById.get(alloc.assetClassId) ?? 0);
    }
    return { id: p.id, name: p.name, blendedReturn };
  });

  return (
    <RetirementAnalysisContent
      clientId={clientId}
      source={source}
      tree={effectiveTree}
      clientNames={clientNames}
      asOfLabel={asOfLabel}
      currentYears={currentYears}
      currentSummary={currentSummary}
      modelPortfolioOptions={modelPortfolioOptions}
    />
  );
}
