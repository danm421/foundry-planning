import BalanceSheetView from "@/components/balance-sheet-view";
import { loadBalanceSheetStepData } from "./balance-sheet-step-data";

interface AccountsStepProps {
  clientId: string;
  firmId: string;
}

export default async function AccountsStep({ clientId, firmId }: AccountsStepProps) {
  const data = await loadBalanceSheetStepData(clientId, firmId);
  if (!data) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 text-[13px] text-ink-3">
        No base case scenario found for this client.
      </div>
    );
  }

  return (
    <BalanceSheetView
      clientId={clientId}
      accounts={data.accountProps}
      liabilities={data.liabilityProps}
      entities={data.entityOptions}
      familyMembers={data.familyMemberRows}
      categoryDefaults={data.categoryDefaults}
      modelPortfolios={data.modelPortfolioOptions}
      ownerNames={data.ownerNames}
      assetClasses={data.assetClassOptions}
      portfolioAllocationsMap={data.portfolioAllocationsMap}
      categoryDefaultSources={data.categoryDefaultSources}
      milestones={data.milestones}
      resolvedInflationRate={data.resolvedInflationRate}
      embed="wizard"
      section="accounts"
    />
  );
}
