// src/lib/integrations/providers/azure-openai/index.ts
import type { ProviderDefinition } from "../../types";
import { isAzureOpenAiEnabled } from "./flag";

/**
 * Credentials-only provider: a firm's own Azure OpenAI resource. It has no
 * households, accounts or positions, so it carries `syncs: false` and no
 * client. Connecting it routes every AI call for the firm into that firm's
 * Azure tenant (src/lib/ai/resolve.ts).
 */
export const azureOpenAiProvider: ProviderDefinition = {
  id: "azure_openai",
  label: "Azure OpenAI",
  scope: "firm",
  isEnabled: isAzureOpenAiEnabled,
  authKind: "byok",
  syncs: false,
};
