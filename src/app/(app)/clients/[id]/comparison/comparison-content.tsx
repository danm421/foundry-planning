import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { scenarios as scenariosTable, clients, crmHouseholdContacts } from "@/db/schema";
import {
  defaultV5,
  listClientComparisons,
  loadComparison,
} from "@/lib/comparison/load-layout";
import { ComparisonPageClient } from "./comparison-page-client";

interface Props {
  clientId: string;
  firmId: string;
}

export async function ComparisonContent({ clientId, firmId }: Props) {
  const [clientRow, scenarios, comparisons] = await Promise.all([
    db
      .select({
        retirementAge: clients.retirementAge,
        crmHouseholdId: clients.crmHouseholdId,
      })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)))
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
      })
      .from(scenariosTable)
      .innerJoin(clients, eq(clients.id, scenariosTable.clientId))
      .where(and(eq(scenariosTable.clientId, clientId), eq(clients.firmId, firmId))),
    listClientComparisons(clientId, firmId),
  ]);

  if (!clientRow) notFound();

  // CRM contacts — sole identity source.
  const [primaryContact] = await db
    .select({
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
      dateOfBirth: crmHouseholdContacts.dateOfBirth,
    })
    .from(crmHouseholdContacts)
    .where(
      and(
        eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId),
        eq(crmHouseholdContacts.role, "primary"),
      ),
    );
  if (!primaryContact) notFound();
  const client = {
    firstName: primaryContact.firstName,
    lastName: primaryContact.lastName,
    dateOfBirth: primaryContact.dateOfBirth,
    retirementAge: clientRow.retirementAge,
  };

  const scenarioLookup: { id: string; name: string }[] = [
    { id: "base", name: "Base case" },
    ...scenarios.map((s) => ({ id: s.id, name: s.name })),
  ];

  const birthYear =
    client.dateOfBirth ? parseInt(client.dateOfBirth.slice(0, 4), 10) : null;
  const clientRetirementYear =
    birthYear !== null && Number.isFinite(birthYear)
      ? birthYear + client.retirementAge
      : null;

  const personalizedDefaultTitle = `${client.firstName} ${client.lastName} — Report`.trim();

  if (comparisons.length === 0) {
    return (
      <ComparisonPageClient
        clientId={clientId}
        scenarios={scenarioLookup}
        primaryScenarioId="base"
        clientRetirementYear={clientRetirementYear}
        comparisons={[]}
        activeCid={null}
        initialLayout={defaultV5({
          primaryScenarioId: "base",
          urlPlanIds: null,
          defaultTitle: personalizedDefaultTitle,
        })}
      />
    );
  }

  const first = comparisons[0];
  const loaded = await loadComparison(first.id, clientId, firmId, {
    primaryScenarioId: "base",
    urlPlanIds: null,
    defaultTitle: personalizedDefaultTitle,
  });

  const initialLayout = loaded?.layout ?? defaultV5({
    primaryScenarioId: "base",
    urlPlanIds: null,
    defaultTitle: personalizedDefaultTitle,
  });

  return (
    <ComparisonPageClient
      clientId={clientId}
      scenarios={scenarioLookup}
      primaryScenarioId="base"
      clientRetirementYear={clientRetirementYear}
      comparisons={comparisons}
      activeCid={first.id}
      initialLayout={initialLayout}
    />
  );
}
