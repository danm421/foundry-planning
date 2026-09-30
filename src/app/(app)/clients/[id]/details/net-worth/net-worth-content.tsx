import BalanceSheetView from "@/components/balance-sheet-view";
import { DefaultGrowthBanner } from "@/components/default-growth-banner";
import { loadNetWorthViewProps } from "./load-view-props";

interface NetWorthContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function NetWorthContent({ clientId: id, scenarioParam }: NetWorthContentProps) {
  const result = await loadNetWorthViewProps(id, scenarioParam);

  if (result.status === "no-base-case") {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DefaultGrowthBanner clientId={id} warning={result.defaultGrowthWarning} />
      <BalanceSheetView {...result.props} />
    </div>
  );
}
