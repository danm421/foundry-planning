// src/components/forge/forge-mount.tsx
"use client";

import { ForgeProvider } from "./forge-provider";
import { ForgePanel } from "./forge-panel";
import { ForgeLauncher } from "./forge-launcher";

/**
 * Client mount for the Forge. Rendered by ClientLayout inside
 * ScenarioModeWrapper as a sibling of ScenarioDrawerProvider so it shares the
 * layout's lifetime and reaches clientId + live scenarioId. Renders nothing
 * when the COPILOT_ENABLED flag (resolved server-side in the layout) is off.
 */
export function ForgeMount({
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
    <ForgeProvider clientId={clientId}>
      <ForgePanel clientId={clientId} clientName={clientName} scenarioNames={scenarioNames} />
      <ForgeLauncher />
    </ForgeProvider>
  );
}
