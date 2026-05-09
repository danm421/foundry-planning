import { requireOrgId } from "@/lib/db-helpers";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
import { ChangesPanel } from "@/components/scenario/changes-panel";

// Layouts in Next 16 don't receive searchParams (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md),
// so each /client-data/<section>/page.tsx mounts this shell to opt into the
// scenario-aware right-rail panel.

interface ClientDataPageShellProps {
  clientId: string;
  scenarioId?: string;
  children: React.ReactNode;
}

export default async function ClientDataPageShell({
  clientId,
  scenarioId,
  children,
}: ClientDataPageShellProps) {
  const panelData = scenarioId
    ? await loadPanelData(clientId, scenarioId, await requireOrgId())
    : null;

  if (!panelData) {
    return <>{children}</>;
  }

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 min-w-0">
      <div className="min-w-0">{children}</div>
      <ChangesPanel
        clientId={clientId}
        scenarioId={panelData.scenarioId}
        scenarioName={panelData.scenarioName}
        changes={panelData.changes}
        toggleGroups={panelData.toggleGroups}
        cascadeWarnings={panelData.cascadeWarnings}
        targetNames={panelData.targetNames}
      />
    </div>
  );
}
