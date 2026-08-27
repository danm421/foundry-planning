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
 *
 * The value is then normalized to its ORIGIN, because what we validate must be
 * what we persist. Microsoft Foundry (Azure's portal) shows a "Target URI" that
 * carries a full path and `?api-version=`; an admin pastes that verbatim, and
 * storing it raw would hand every downstream consumer a broken baseURL. The
 * origin also drops any `user:pass@` userinfo, which must never reach the
 * plaintext `scope` column.
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
  )
  // Runs only once the refine above has passed, so `new URL` cannot throw here.
  .transform((raw) => new URL(raw).origin);

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
  // `raw` is the DECRYPTED secret blob. Node's JSON.parse embeds the first ~10
  // characters of its input in the SyntaxError message, so a legacy raw key or a
  // corrupt decrypt would put key bytes into any log line, audit field, or
  // response body that surfaces `err.message`. Rethrow a fixed string instead.
  // Zod's own errors report types and constraints, never values, so the schema
  // parse below is safe to let through.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("azure secret malformed");
  }
  return azureSecretSchema.parse(parsed);
}

export function encodeAzureConfig(c: AzureConfig): string {
  return JSON.stringify(azureConfigSchema.parse(c));
}

export function decodeAzureConfig(raw: string | null): AzureConfig {
  if (!raw) throw new Error("azure config missing");
  return azureConfigSchema.parse(JSON.parse(raw));
}
