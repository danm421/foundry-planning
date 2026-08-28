// src/app/api/integrations/[provider]/_azure.ts
//
// Shared pieces between the azure_openai `connect` and `test` routes: the
// credential field schema and the mapping into the AiCredentials shape the
// verifier consumes. Mirrors _addepar.ts.
import { z } from "zod";
import { azureEndpointSchema, type AiCredentials } from "@/lib/ai/credentials";

/** The 6 credential fields both routes accept. `connect` extends this with the
 *  attestation checkbox; `test` uses it as-is. */
export const azureCredsSchema = z.object({
  endpoint: azureEndpointSchema,
  apiKey: z.string().min(1),
  apiVersion: z.string().min(1),
  chatDeployment: z.string().min(1),
  miniDeployment: z.string().min(1),
  embeddingDeployment: z.string().min(1),
});

export type AzureCredsInput = z.infer<typeof azureCredsSchema>;

/** Ephemeral credentials for validation — never persisted from here. */
export function credsToAiCredentials(input: AzureCredsInput): AiCredentials {
  return {
    source: "firm",
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    apiVersion: input.apiVersion,
    deployments: {
      chat: input.chatDeployment,
      mini: input.miniDeployment,
      embedding: input.embeddingDeployment,
    },
  };
}

/**
 * One-line summary of the first failed check, for the toast — and, since the
 * recheck route writes it onto the connection row, for the sentence the error
 * card shows the admin.
 *
 * These three labels MUST match AzureOpenAiCard's CHECK_LABEL. They land on the
 * same screen: the card renders this sentence directly above a check list built
 * from its own labels, so "Embedding model" here beside "Search model" there
 * reads as two different deployments failing.
 */
export function firstFailureMessage(checks: { name: string; ok: boolean; detail?: string }[]): string {
  const failed = checks.find((c) => !c.ok);
  if (!failed) return "Could not verify that Azure OpenAI connection.";
  const label =
    failed.name === "chat"
      ? "Main model"
      : failed.name === "mini"
        ? "Fast model"
        : "Search model";
  return `${label}: ${failed.detail ?? "check failed"}`;
}
