import { requireOrgId } from "@/lib/db-helpers";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
import { ScenarioDrawer } from "@/components/scenario/scenario-drawer";

// Mirrors DetailsPageShell: layouts in Next 16 don't receive searchParams, so
// each in-scope page mounts this shell with its own `scenario` query param to
// opt into the right-edge changes drawer. Unlike DetailsPageShell, this renders
// children full-width and the drawer as a fixed overlay (no grid column).

interface ScenarioDrawerShellProps {
  clientId: string;
  scenarioId?: string;
  children: React.ReactNode;
}

export default async function ScenarioDrawerShell({
  clientId,
  scenarioId,
  children,
}: ScenarioDrawerShellProps) {
  const panelData = scenarioId
    ? await loadPanelData(clientId, scenarioId, await requireOrgId())
    : null;

  if (!panelData) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <ScenarioDrawer
        clientId={clientId}
        scenarioId={panelData.scenarioId}
        scenarioName={panelData.scenarioName}
        changes={panelData.changes}
        toggleGroups={panelData.toggleGroups}
        cascadeWarnings={panelData.cascadeWarnings}
        targetNames={panelData.targetNames}
      />
    </>
  );
}
