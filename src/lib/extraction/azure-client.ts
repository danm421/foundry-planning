import { AzureOpenAI } from "openai";
import { auth } from "@clerk/nextjs/server";
import { resolveAiCredentials } from "@/lib/ai/resolve";
import { azureClientOptions } from "@/lib/ai/client";
import { isAzureAuthFailure, markAiConnectionError } from "@/lib/ai/connection-status";
import type { AiCredentials } from "@/lib/ai/credentials";

/** One cached client per distinct tenant+key, so a firm's client is reused
 *  across calls without ever being handed to another firm. The key carries the
 *  endpoint and the key itself — never "the last client we built" — which is
 *  what keeps firm A's client out of firm B's call on a warm instance. */
const clientCache = new Map<string, AzureOpenAI>();

/**
 * Resolve whose tenant this call runs in, then build (or reuse) that tenant's
 * client. Every AI call goes through here, so the resolver is asked EVERY time:
 * a firm that connects its own resource is served from it on the very next call.
 */
async function getClient(): Promise<{ client: AzureOpenAI; creds: AiCredentials }> {
  const creds = await resolveAiCredentials();
  // Defence in depth, and deliberately the same sentinel the credential sources
  // already throw: foundrySystemCredentials() refuses an unset AZURE_API_KEY and
  // azureSecretSchema requires min(1), so this is unreachable today. If it ever
  // fires, callers that branch on ai_not_configured (the meeting-prep route,
  // observations draft) must still recognise it — prose here would fall out of
  // the closed set, and telling a connected firm to "set AZURE_API_KEY in
  // .env.local" would be nonsense for them.
  if (!creds.apiKey) throw new Error("ai_not_configured");
  const cacheKey = `${creds.endpoint}|${creds.apiVersion}|${creds.apiKey}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new AzureOpenAI(azureClientOptions(creds));
    clientCache.set(cacheKey, client);
  }
  return { client, creds };
}

/**
 * Runs one Azure SDK call and, when a FIRM's own key is what got rejected,
 * flips that firm's connection to `error` — so the Integrations card explains
 * why AI stopped instead of the advisor seeing an opaque failure forever.
 *
 * One helper rather than a copy at each of the three call sites below: `creds`
 * is in scope at all three, and three verbatim copies of one branch drift.
 *
 * Three things it must never do:
 *  - Flip on `source: "foundry"`. A rejection against Foundry Planning's own
 *    key is OUR outage; flagging the firm's connection for it would send them
 *    to re-check credentials that are fine.
 *  - Replace the original error. The caller's message is what surfaces to the
 *    advisor; this is bookkeeping beside it, never instead of it. `auth()`
 *    THROWS outside a request context (measured — see the note in resolve.ts),
 *    so the bookkeeping gets its own try even though markAiConnectionError
 *    already promises not to throw.
 *  - Widen past 401/403 — see isAzureAuthFailure.
 */
async function reportingAuthFailures<T>(
  creds: AiCredentials,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (creds.source === "firm" && isAzureAuthFailure(err)) {
      try {
        const { orgId } = await auth();
        if (orgId) await markAiConnectionError(orgId, "Azure rejected the API key.");
      } catch {
        // swallowed by design — the throw below is what the caller needs
      }
    }
    throw err;
  }
}

/** Resolve the "mini"/"full" aliases against the caller's deployments. An
 *  explicit deployment name passes through untouched. */
function deploymentFor(creds: AiCredentials, model: "mini" | "full" | (string & {})): string {
  if (model === "full") return creds.deployments.chat;
  if (model === "mini") return creds.deployments.mini;
  return model;
}

export interface AIExtractionResult {
  content: string;
  finishReason: string | null;
}

/**
 * Call Azure OpenAI for document extraction, returning both the response
 * content and the model's `finish_reason` (so callers can detect a truncated
 * `"length"` completion and continue).
 *
 * `model` accepts the "mini" / "full" aliases (resolved against whichever
 * tenant this call runs in) or an explicit deployment name like "gpt-5.4" —
 * useful when a caller wants to pin the model.
 */
export async function callAIExtractionWithMeta(
  systemPrompt: string,
  userPrompt: string,
  model: "mini" | "full" | (string & {}) = "mini"
): Promise<AIExtractionResult> {
  const { client, creds } = await getClient();
  const modelName = deploymentFor(creds, model);

  // Removed `x-ms-azureai-sensitivity: "high"` request header
  // (commit e2834b0). The header was added as defense-in-depth for
  // Partial-ZDR routing, but in practice every extraction (small or
  // large, sensitive or bland) returned 400 "The response was filtered
  // due to the prompt triggering Azure OpenAI's content management
  // policy" once it landed. Verified during the Phase 8 smoke: a
  // 4kB blank-presentation PDF tripped the same filter as a real
  // fact-finder. ZDR is already granted at the resource level by
  // Microsoft, so dropping this header changes nothing about
  // retention posture. Re-add later only with a verified value
  // and a link to the relevant Azure doc.
  const response = await reportingAuthFailures(creds, () =>
    client.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // 16k keeps completions inside our 60s function budget and caps cost
      // exposure per request (see SECURITY_AUDIT.md §C7).
      max_completion_tokens: 16000,
    }),
  );

  const choice = response.choices[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI returned empty content");
  }
  // `choice` is known truthy here (its content was non-empty above).
  return { content, finishReason: choice.finish_reason ?? null };
}

/**
 * Convenience wrapper over {@link callAIExtractionWithMeta} that returns just
 * the response content string.
 */
export async function callAIExtraction(
  systemPrompt: string,
  userPrompt: string,
  model: "mini" | "full" | (string & {}) = "mini"
): Promise<string> {
  return (await callAIExtractionWithMeta(systemPrompt, userPrompt, model)).content;
}

/**
 * Embed a single string via the caller's Azure OpenAI embeddings deployment. No
 * SDK change — the cached AzureOpenAI client already exposes
 * `.embeddings.create`. Fails CLOSED when the resolved credentials name no
 * embeddings deployment, and asserts the 1536-dim contract the pgvector column
 * requires, so a wrong deployment surfaces at the call site, not as a DB error.
 */
export async function callAIEmbedding(input: string): Promise<number[]> {
  const { client, creds } = await getClient();
  const model = creds.deployments.embedding;
  if (!model) throw new Error("ai_embedding_not_configured");
  const response = await reportingAuthFailures(creds, () =>
    client.embeddings.create({ model, input }),
  );
  const vec = response.data[0]?.embedding;
  if (!vec || vec.length !== 1536) {
    throw new Error("embedding_dim_mismatch");
  }
  return vec;
}

export interface VisionImage {
  b64: string;
  mime: string;
}

/**
 * Transcribe scanned/image PDF pages to text via the Azure OpenAI vision
 * deployment. Used only as a fallback when a PDF has no embedded text layer.
 * Note: page images are sent un-redacted (pixels cannot be SSN-redacted);
 * Azure resource-level ZDR means in-transit only, and redaction still runs on
 * the returned text before the downstream extraction call.
 */
export async function callAIVisionTranscription(
  images: VisionImage[],
  model: "mini" | "full" | (string & {}) = "mini",
): Promise<string> {
  const { client, creds } = await getClient();
  const modelName = deploymentFor(creds, model);

  const instruction =
    "Transcribe every page of this financial statement image verbatim. " +
    "Preserve all numbers exactly as shown. Render tabular data (holdings, " +
    "transactions) as GitHub-flavored markdown tables. Do not summarize, " +
    "interpret, or omit any rows. Output only the transcribed text.";

  const content = [
    { type: "text", text: instruction },
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.b64}` },
    })),
  ];

  const response = await reportingAuthFailures(creds, () =>
    client.chat.completions.create({
      model: modelName,
      messages: [{ role: "user", content }] as unknown as Parameters<typeof client.chat.completions.create>[0]["messages"],
      max_completion_tokens: 16000,
    }),
  );

  const out = response.choices[0]?.message?.content;
  if (!out) {
    throw new Error("Azure OpenAI returned empty transcription");
  }
  return out;
}
