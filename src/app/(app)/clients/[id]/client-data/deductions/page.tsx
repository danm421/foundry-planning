import { db } from "@/db";
import { clients, scenarios, clientDeductions, savingsRules, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { redirect } from "next/navigation";
import { DeductionsClient } from "./deductions-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DeductionsPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) redirect("/clients");

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return <div className="p-6 text-sm text-gray-400">No base case scenario found.</div>;
  }

  const [deductionRows, savingsRows, accountRows] = await Promise.all([
    db.select().from(clientDeductions).where(and(eq(clientDeductions.clientId, id), eq(clientDeductions.scenarioId, scenario.id))),
    db.select().from(savingsRules).where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenario.id))),
    db.select().from(accounts).where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
  ]);

  // Compute current-year auto-derived for the read-only summary
  const currentYear = new Date().getFullYear();

  const derivedRows = savingsRows
    .filter((r) => {
      const acct = accountRows.find((a) => a.id === r.accountId);
      if (!acct) return false;
      if (acct.subType !== "traditional_ira" && acct.subType !== "401k") return false;
      if (currentYear < r.startYear || currentYear > r.endYear) return false;
      return true;
    })
    .map((r) => {
      const acct = accountRows.find((a) => a.id === r.accountId)!;
      return {
        id: r.id,
        accountName: acct.name,
        subType: acct.subType ?? "",
        annualAmount: parseFloat(r.annualAmount),
        owner: acct.owner,
        startYear: r.startYear,
        endYear: r.endYear,
      };
    });

  const itemizedRows = deductionRows.map((d) => ({
    id: d.id,
    type: d.type,
    name: d.name,
    owner: d.owner,
    annualAmount: parseFloat(d.annualAmount),
    growthRate: parseFloat(d.growthRate),
    startYear: d.startYear,
    endYear: d.endYear,
    startYearRef: d.startYearRef,
    endYearRef: d.endYearRef,
  }));

  return (
    <DeductionsClient
      clientId={id}
      derivedRows={derivedRows}
      itemizedRows={itemizedRows}
      currentYear={currentYear}
    />
  );
}
