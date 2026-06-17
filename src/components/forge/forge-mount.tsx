// src/components/copilot/forge-mount.tsx
"use client";

import { CopilotProvider } from "./forge-provider";
import { CopilotPanel } from "./forge-panel";
import { CopilotLauncher } from "./forge-launcher";

/**
 * Client mount for the Copilot. Rendered by ClientLayout inside
 * ScenarioModeWrapper as a sibling of ScenarioDrawerProvider so it shares the
 * layout's lifetime and reaches clientId + live scenarioId. Renders nothing
 * when the COPILOT_ENABLED flag (resolved server-side in the layout) is off.
 */
export function CopilotMount({
  clientId,
  clientName,
  enabled,
  scenarioNames,
}: {
  clientId: string;
  clientName: string;
  enabled: boolean;
  scenarioNames: Record<string, string>;
}) {
  if (!enabled) return null;
  return (
    <CopilotProvider clientId={clientId}>
      <CopilotPanel clientId={clientId} clientName={clientName} scenarioNames={scenarioNames} />
      <CopilotLauncher />
    </CopilotProvider>
  );
}
