// src/lib/integrations/providers/azure-openai/flag.ts

/**
 * Bring-your-own Azure OpenAI kill-switch. Mirrors the inline
 * `process.env.X === "true"` flag pattern used by the other providers
 * (src/lib/integrations/providers/addepar/flag.ts). Strict equality — no truthy
 * coercion — so a stray "1"/"yes"/"" never silently enables it.
 *
 * OFF everywhere until the feature has had a browser pass.
 */
export function isAzureOpenAiEnabled(): boolean {
  return process.env.AZURE_BYOK_ENABLED === "true";
}
