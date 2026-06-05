import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings as planSettingsTable,
  expenses as expensesTable,
  incomes as incomesTable,
  familyMembers as familyTable,
} from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import { loadClientIdentity } from "@/lib/quick-start/load-identity";
import { QuickStartWizard, type QsBootstrap } from "./quick-start-wizard";

export default async function QuickStartPage({ params }: { params: Promise<{ id: string }> }) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));
  if (!scenario) notFound();

  const [settings] = await db
    .select()
    .from(planSettingsTable)
    .where(
      and(eq(planSettingsTable.clientId, id), eq(planSettingsTable.scenarioId, scenario.id)),
    );

  const identity = await loadClientIdentity(id);

  const exp = await db
    .select()
    .from(expensesTable)
    .where(and(eq(expensesTable.clientId, id), eq(expensesTable.scenarioId, scenario.id)));
  const currentStub = exp.find((e) => e.endYearRef === "client_retirement") ?? null;
  const retirementStub = exp.find((e) => e.startYearRef === "client_retirement") ?? null;

  const inc = await db
    .select()
    .from(incomesTable)
    .where(
      and(
        eq(incomesTable.clientId, id),
        eq(incomesTable.scenarioId, scenario.id),
        eq(incomesTable.type, "social_security"),
      ),
    );
  const ssClient = inc.find((i) => i.owner === "client") ?? null;
  const ssSpouse = inc.find((i) => i.owner === "spouse") ?? null;

  const fam = await db.select().from(familyTable).where(eq(familyTable.clientId, id));
  const famClient = fam.find((f) => f.role === "client") ?? null;
  const famSpouse = fam.find((f) => f.role === "spouse") ?? null;

  const currentYear = new Date().getFullYear();
  const bootstrap: QsBootstrap = {
    clientId: id,
    ctxInput: {
      client: {
        dateOfBirth: identity.dateOfBirth,
        retirementAge: identity.retirementAge,
        planEndAge: identity.planEndAge,
        spouseDob: identity.spouseDob,
        spouseRetirementAge: identity.spouseRetirementAge,
      },
      planStartYear: settings?.planStartYear ?? currentYear,
      planEndYear: settings?.planEndYear ?? currentYear + 40,
      clientFirstName: identity.clientFirstName,
      spouseFirstName: identity.spouseFirstName,
      hasSpouse: identity.hasSpouse,
    },
    residenceState: settings?.residenceState ?? null,
    expenseStubs: { currentId: currentStub?.id ?? null, retirementId: retirementStub?.id ?? null },
    ssStubs: {
      client: ssClient
        ? {
            id: ssClient.id,
            monthlyBenefit: ssClient.piaMonthly != null ? Number(ssClient.piaMonthly) : null,
            claimingAge: ssClient.claimingAge != null ? Number(ssClient.claimingAge) : null,
          }
        : null,
      spouse: ssSpouse
        ? {
            id: ssSpouse.id,
            monthlyBenefit: ssSpouse.piaMonthly != null ? Number(ssSpouse.piaMonthly) : null,
            claimingAge: ssSpouse.claimingAge != null ? Number(ssSpouse.claimingAge) : null,
          }
        : null,
    },
    familyMemberIds: { client: famClient?.id ?? null, spouse: famSpouse?.id ?? null },
    defaultGrowth: {
      taxable: Number(settings?.defaultGrowthTaxable ?? 0.07),
      cash: Number(settings?.defaultGrowthCash ?? 0.02),
      retirement: Number(settings?.defaultGrowthRetirement ?? 0.07),
      realEstate: Number(settings?.defaultGrowthRealEstate ?? 0.04),
      lifeInsurance: Number(settings?.defaultGrowthLifeInsurance ?? 0.03),
      inflation: Number(settings?.inflationRate ?? 0.03),
    },
  };
  return <QuickStartWizard bootstrap={bootstrap} />;
}
