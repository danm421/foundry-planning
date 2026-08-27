// src/lib/ai/credentials.ts
//
// Shapes and codecs for a firm's own Azure OpenAI credentials. Pure — no DB,
// no network, no Clerk. The storage split mirrors Addepar's BYOK path
// (src/lib/integrations/providers/addepar/credentials.ts): the secret blob is
// encrypted into `integration_connections.access_token_enc`, the config blob is
// stored plaintext in `scope`.
import { z } from "zod";

/** Deployment names, resolved per firm. `chat` is the reasoning-heavy model
 *  ("full"), `mini` the cheap narration model, `embedding` powers Forge search. */
export type AiDeployments = {
  chat: string;
  mini: string;
  embedding: string;
};

/** Everything an Azure client needs, plus which tenant it belongs to. */
export type AiCredentials = {
  source: "firm" | "foundry";
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  deployments: AiDeployments;
};

const AZURE_SUFFIX = ".openai.azure.com";

/**
 * SSRF guard, same shape as `addeparApiBaseSchema`: the endpoint must be an
 * https URL on an `<instance>.openai.azure.com` host. Prevents an org-admin from
 * pointing our outbound client at internal or link-local hosts
 * (169.254.169.254, localhost), and stops lookalike suffixes like
 * `acme.openai.azure.com.evil.com` by requiring the suffix to END the hostname
 * and leave a non-empty instance in front of it.
 */
export const azureEndpointSchema = z
  .string()
  .url()
  .refine(
    (raw) => {
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        return false;
      }
      if (u.protocol !== "https:") return false;
      const h = u.hostname.toLowerCase();
      if (!h.endsWith(AZURE_SUFFIX)) return false;
      return h.slice(0, -AZURE_SUFFIX.length).length > 0;
    },
    { message: "endpoint must be an https:// URL on an <instance>.openai.azure.com host" },
  );

export type AzureSecret = { apiKey: string };
export type AzureConfig = {
  endpoint: string;
  apiVersion: string;
  chatDeployment: string;
  miniDeployment: string;
  embeddingDeployment: string;
};

export const azureSecretSchema = z.object({ apiKey: z.string().min(1) });

export const azureConfigSchema = z.object({
  endpoint: azureEndpointSchema,
  apiVersion: z.string().min(1),
  chatDeployment: z.string().min(1),
  miniDeployment: z.string().min(1),
  embeddingDeployment: z.string().min(1),
});

export function encodeAzureSecret(s: AzureSecret): string {
  return JSON.stringify(azureSecretSchema.parse(s));
}

export function decodeAzureSecret(raw: string): AzureSecret {
  return azureSecretSchema.parse(JSON.parse(raw));
}

export function encodeAzureConfig(c: AzureConfig): string {
  return JSON.stringify(azureConfigSchema.parse(c));
}

export function decodeAzureConfig(raw: string | null): AzureConfig {
  if (!raw) throw new Error("azure config missing");
  return azureConfigSchema.parse(JSON.parse(raw));
}
