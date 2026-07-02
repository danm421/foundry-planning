import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { buildBalanceSheetReportProps } from "@/lib/balance-sheet/build-report-props";
import BalanceSheetReport from "@/components/balance-sheet-report/balance-sheet-report";

interface BalanceSheetReportContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function BalanceSheetReportContent({ clientId: id, scenarioParam }: BalanceSheetReportContentProps) {
  const firmId = await requireOrgId();

  const [clientRow] = await db
    .select({ id: clients.id, crmHouseholdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!clientRow) notFound();

  // Owner labels (first names) from CRM contacts; fall back to the tree.
  // crmHouseholdId is notNull on the clients table so no null-guard needed.
  // Both reads are independent — run them concurrently.
  const [{ tree, result }, contactRows] = await Promise.all([
    loadProjectionForRef(id, firmId, {
      kind: "scenario",
      id: scenarioParam ?? "base",
      toggleState: {},
    }),
    db
      .select({ role: crmHouseholdContacts.role, firstName: crmHouseholdContacts.firstName })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId)),
  ]);

  const clientLabel =
    contactRows.find((c) => c.role === "primary")?.firstName ?? tree.client.firstName ?? "Client";
  const spouseContact = contactRows.find((c) => c.role === "spouse");

  // Shared derivation (titling, year slimming, spouse gating, trust details)
  // lives in buildBalanceSheetReportProps — also used by the solver's live
  // Balance Sheet tab.
  const reportProps = buildBalanceSheetReportProps(tree, result.years, {
    clientLabel,
    spouseName: spouseContact?.firstName ?? tree.client.spouseName ?? "Spouse",
  });

  return <BalanceSheetReport {...reportProps} todayYear={new Date().getFullYear()} />;
}
