// src/lib/ai/client.ts
import type { AiCredentials } from "./credentials";

/** Options for an AzureOpenAI client built from resolved credentials. */
export function azureClientOptions(
  creds: Pick<AiCredentials, "apiKey" | "endpoint" | "apiVersion">,
) {
  return {
    apiKey: creds.apiKey,
    endpoint: creds.endpoint,
    apiVersion: creds.apiVersion,
    // 55s keeps every call (and each multi-pass fan-out call) inside the 300s
    // function budget; the SDK default is 10 minutes, which can outlive the
    // function and strand a slot. maxRetries:1 stops a hung call retrying past
    // the budget (SDK default is 2).
    timeout: 55_000,
    maxRetries: 1,
  };
}
