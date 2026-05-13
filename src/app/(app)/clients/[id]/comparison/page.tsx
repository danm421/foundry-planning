import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { scenarios as scenariosTable, clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import {
  defaultV5,
  listClientComparisons,
  loadComparison,
} from "@/lib/comparison/load-layout";
import { ComparisonPageClient } from "./comparison-page-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ComparisonPage({ params }: PageProps) {
  const { id: clientId } = await params;
  const firmId = await requireOrgId();

  const [client, scenarios, comparisons] = await Promise.all([
    db
      .select({
        firstName: clients.firstName,
        lastName: clients.lastName,
        dateOfBirth: clients.dateOfBirth,
        retirementAge: clients.retirementAge,
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

  if (!client) notFound();

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
