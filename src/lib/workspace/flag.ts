// src/lib/workspace/flag.ts

/**
 * Workspace (Microsoft 365 calendar & to-dos) kill-switch. Same inline-env
 * pattern as src/lib/integrations/providers/orion/flag.ts: strict equality on
 * "true" — no truthy coercion — so a stray "1"/"yes"/"" never silently enables
 * it. Unset or anything else hides Workspace entirely.
 */
export function isWorkspaceEnabled(): boolean {
  return process.env.WORKSPACE_ENABLED === "true";
}
