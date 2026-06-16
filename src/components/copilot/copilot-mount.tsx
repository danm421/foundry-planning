// src/components/copilot/copilot-mount.tsx
"use client";

import { CopilotProvider } from "./copilot-provider";
import { CopilotPanel } from "./copilot-panel";
import { CopilotLauncher } from "./copilot-launcher";

/**
 * Client mount for the Copilot. Rendered by ClientLayout inside
 * ScenarioModeWrapper as a sibling of ScenarioDrawerProvider so it shares the
 * layout's lifetime and reaches clientId + live scenarioId. Renders nothing
 * when the COPILOT_ENABLED flag (resolved server-side in the layout) is off.
 */
export function CopilotMount({
  clientId,
  enabled,
  scenarioNames,
}: {
  clientId: string;
  enabled: boolean;
  scenarioNames: Record<string, string>;
}) {
  if (!enabled) return null;
  return (
    <CopilotProvider clientId={clientId}>
      <CopilotPanel clientId={clientId} scenarioNames={scenarioNames} />
      <CopilotLauncher />
    </CopilotProvider>
  );
}
