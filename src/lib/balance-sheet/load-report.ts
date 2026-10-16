// src/lib/balance-sheet/load-report.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import { buildBalanceSheetReportProps } from "./build-report-props";

/**
 * Loads the Balance Sheet report's data for a household and scenario. The
 * report page and its PDF export both load through here, so a PDF always
 * prints the numbers and owner names the advisor is looking at.
 * Callers have already authorized `clientId` for `firmId`.
 */
export async function loadBalanceSheetReport(
  clientId: string,
  firmId: string,
  crmHouseholdId: string,
  scenarioParam: string | null | undefined,
) {
  const [{ tree, result, scenarioName }, contactRows] = await Promise.all([
    loadProjectionForRef(clientId, firmId, {
      kind: "scenario",
      id: scenarioParam ?? "base",
      toggleState: {},
    }),
    db
      .select({
        role: crmHouseholdContacts.role,
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
      })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, crmHouseholdId)),
  ]);

  // Owner labels (first names) from CRM contacts; fall back to the tree.
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  const clientLabel = primaryContact?.firstName ?? tree.client.firstName ?? "Client";

  return {
    report: buildBalanceSheetReportProps(tree, result.years, {
      clientLabel,
      spouseName: spouseContact?.firstName ?? tree.client.spouseName ?? CO_CLIENT_LABEL,
    }),
    /** Null for the base case. */
    scenarioName: scenarioParam && scenarioParam !== "base" ? scenarioName : null,
    primaryContact,
  };
}
