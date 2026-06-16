// src/domain/copilot/llm.ts
import { AzureChatOpenAI } from "@langchain/openai";
import { callAIEmbedding } from "@/lib/extraction/azure-client";

/**
 * Azure config the copilot chat model needs. Foundry's env differs from
 * ethos: AZURE_ENDPOINT is a FULL URL (https://<instance>.openai.azure.com),
 * not a bare resource name — see src/lib/extraction/azure-client.ts. We derive
 * the bare <instance> for AzureChatOpenAI's azureOpenAIApiInstanceName.
 */
export type CopilotAzureConfig = {
  instanceName: string;
  apiKey: string;
  apiVersion: string;
  deployment: string;
};

/**
 * Pull the `<instance>` subdomain out of a full Azure OpenAI endpoint URL.
 * `https://ethoshub-resource.openai.azure.com` → `ethoshub-resource`.
 * Throws `ai_not_configured` for anything that isn't a *.openai.azure.com URL,
 * so a misconfigured endpoint fails loudly at construct time rather than as an
 * opaque 401 on the first completion.
 */
export function instanceNameFromEndpoint(endpoint: string): string {
  let host: string;
  try {
    host = new URL(endpoint).host; // throws on "not-a-url"
  } catch {
    throw new Error("ai_not_configured");
  }
  const suffix = ".openai.azure.com";
  if (!host.endsWith(suffix)) throw new Error("ai_not_configured");
  const instance = host.slice(0, -suffix.length);
  if (!instance) throw new Error("ai_not_configured");
  return instance;
}

/**
 * Build the Azure config from env. `model` selects the deployment:
 *   "full" → AZURE_ANALYSIS_MODEL (gpt-5.4, reasoning-heavy turns)
 *   "mini" → AZURE_MODEL          (gpt-5.4-mini, cheap narration)
 * Throws `ai_not_configured` if any required env var is missing — same
 * sentinel string the extraction path uses, so callers can branch uniformly.
 */
export function assertCopilotAzureConfig(model: "full" | "mini"): CopilotAzureConfig {
  const endpoint = process.env.AZURE_ENDPOINT;
  const apiKey = process.env.AZURE_API_KEY;
  const apiVersion = process.env.AZURE_API_VERSION;
  const deployment =
    model === "full" ? process.env.AZURE_ANALYSIS_MODEL : process.env.AZURE_MODEL;
  if (!endpoint || !apiKey || !apiVersion || !deployment) {
    throw new Error("ai_not_configured");
  }
  return {
    instanceName: instanceNameFromEndpoint(endpoint),
    apiKey,
    apiVersion,
    deployment,
  };
}

/**
 * Tool-calling chat model for the copilot. Both deployments (gpt-5.4 /
 * gpt-5.4-mini) are GPT-5-series *reasoning* models, which reject any
 * `temperature` other than the default — passing `temperature: 0` makes Azure
 * 400 (`unsupported_value`) on the very first turn, so the stream route would
 * emit a generic error with zero tokens. We therefore send NO temperature,
 * mirroring the extraction path against the same deployment
 * (src/lib/extraction/azure-client.ts, which passes only `max_completion_tokens`).
 * `@langchain/openai` includes `temperature` in the request whenever it is set
 * (completions invocationParams) and does not strip it for reasoning models, so
 * the fix is to leave it unset rather than rely on the library.
 *
 * `streaming: true` is REQUIRED so LangGraph streamEvents v2 surfaces
 * on_chat_model_stream token deltas — without it invoke() makes one
 * non-streaming call and the reply arrives as a single chunk (the exact bug
 * ethos hit). Defaults to the full (gpt-5.4) deployment.
 */
export function chatModel(model: "full" | "mini" = "full"): AzureChatOpenAI {
  const { instanceName, apiKey, apiVersion, deployment } = assertCopilotAzureConfig(model);
  return new AzureChatOpenAI({
    azureOpenAIApiKey: apiKey,
    azureOpenAIApiInstanceName: instanceName,
    azureOpenAIApiDeploymentName: deployment,
    azureOpenAIApiVersion: apiVersion,
    streaming: true,
  });
}

/**
 * Embed copilot text (KB ingest + query-time retrieval). A thin re-export so
 * the copilot domain owns its embedding entry point; the Azure specifics live
 * in azure-client.ts. 1536-dim, fail-closed contract is enforced there.
 */
export async function embeddings(text: string): Promise<number[]> {
  return callAIEmbedding(text);
}
