import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { buildViewModelInputs } from "@/lib/balance-sheet/build-view-model-inputs";
import { buildTrustDetails } from "@/lib/balance-sheet/trust-details";
import { mergeSyntheticAccounts } from "@/lib/balance-sheet/merge-synthetic-accounts";
import BalanceSheetReport, { type BalanceSheetReportProps, type BalanceSheetProjYear } from "@/components/balance-sheet-report/balance-sheet-report";

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

  const inputs = buildViewModelInputs(mergeSyntheticAccounts(tree, result.years));

  // Attach titlingType (drives the Joint-column rule) to the account inputs.
  const titlingById = new Map(
    (tree.accounts ?? []).map((a) => [a.id, a.titlingType]),
  );
  const accounts: BalanceSheetReportProps["accounts"] = inputs.accounts.map((a) => ({
    ...a,
    titlingType: titlingById.get(a.id) ?? null,
  }));

  // Slim each projection year to the fields both helpers read.
  // ProjectionYearLike needs: year, portfolioAssets, accountLedgers,
  // liabilityBalancesBoY, entityAccountSharesEoY?, familyAccountSharesEoY?
  // HouseholdProjYear needs: year, accountLedgers, liabilityBalancesBoY,
  // notesReceivableByNote?
  const projectionYears = result.years.map((y) => ({
    year: y.year,
    portfolioAssets: y.portfolioAssets,
    accountLedgers: y.accountLedgers,
    liabilityBalancesBoY: y.liabilityBalancesBoY,
    notesReceivableByNote: y.notesReceivableByNote,
    entityAccountSharesEoY: y.entityAccountSharesEoY,
    familyAccountSharesEoY: y.familyAccountSharesEoY,
  })) satisfies BalanceSheetProjYear[];

  const selectableYears = projectionYears.map((y) => y.year);
  const currentYear = new Date().getFullYear();
  // Household ages per projection year — annotates each year-picker option.
  const agesByYear: Record<number, { client: number; spouse?: number }> = {};
  for (const y of result.years) agesByYear[y.year] = y.ages;
  const clientLabel =
    contactRows.find((c) => c.role === "primary")?.firstName ?? tree.client.firstName ?? "Client";
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  const hasSpouse = (tree.familyMembers ?? []).some((fm) => fm.role === "spouse");
  const spouseLabel = hasSpouse
    ? (spouseContact?.firstName ?? tree.client.spouseName ?? "Spouse")
    : null;

  const trustDetails = buildTrustDetails(tree, { clientLabel, spouseLabel });

  return (
    <BalanceSheetReport
      accounts={accounts}
      liabilities={inputs.liabilities}
      entities={inputs.entities}
      trustDetails={trustDetails}
      notesReceivable={inputs.notesReceivable}
      familyMembers={inputs.familyMembers}
      projectionYears={projectionYears}
      selectableYears={selectableYears}
      agesByYear={agesByYear}
      todayYear={currentYear}
      clientLabel={clientLabel}
      spouseLabel={spouseLabel}
    />
  );
}
