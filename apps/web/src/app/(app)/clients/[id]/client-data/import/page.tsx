import { db } from "@foundry/db";
import { clients, scenarios, accounts, planSettings } from "@foundry/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { redirect } from "next/navigation";
import ImportPageClient from "./import-client";

interface ImportPageProps {
  params: Promise<{ id: string }>;
}

export default async function ImportPage({ params }: ImportPageProps) {
  const { id } = await params;
  const firmId = await getOrgId();

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) redirect("/clients");

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) redirect("/clients");

  // Fetch existing account names for duplicate detection
  const existingAccounts = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id)));

  // Fetch plan settings for default years
  const [settings] = await db
    .select()
    .from(planSettings)
    .where(
      and(
        eq(planSettings.clientId, id),
        eq(planSettings.scenarioId, scenario.id)
      )
    );

  const currentYear = new Date().getFullYear();

  return (
    <ImportPageClient
      clientId={id}
      existingAccountNames={existingAccounts.map((a) => a.name)}
      defaultStartYear={settings?.planStartYear ?? currentYear}
      defaultEndYear={settings?.planEndYear ?? currentYear + 30}
    />
  );
}
