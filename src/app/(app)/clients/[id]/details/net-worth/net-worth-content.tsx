import BalanceSheetView from "@/components/balance-sheet-view";
import { DefaultGrowthBanner } from "@/components/default-growth-banner";
import { IntegrationClientStatus } from "@/components/IntegrationClientStatus";
import { requireClientPageAccess } from "@/lib/clients/page-access";
import { loadClientIntegrationStatus } from "@/lib/integrations/client-status";
import { loadNetWorthViewProps } from "./load-view-props";

interface NetWorthContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function NetWorthContent({ clientId: id, scenarioParam }: NetWorthContentProps) {
  const [result, integration] = await Promise.all([
    loadNetWorthViewProps(id, scenarioParam),
    requireClientPageAccess(id).then((access) => loadClientIntegrationStatus(id, access)),
  ]);

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
      <BalanceSheetView
        {...result.props}
        footerActions={integration ? <IntegrationClientStatus clientId={id} {...integration} /> : undefined}
      />
    </div>
  );
}
