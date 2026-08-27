// src/lib/ai/resolve.ts
//
// Decides WHOSE Azure OpenAI tenant an AI call runs in. Both AI factories
// (src/lib/extraction/azure-client.ts and src/domain/forge/llm.ts) call this and
// nothing else does.
//
// The rule that makes the compliance promise real:
//   NO FIRM IDENTITY => THROW. Never fall back to Foundry Planning's key.
// Every in-app AI call sits behind org auth (verified: no portal, public or
// cron route reaches AI), so a missing orgId means a bug or an unsanctioned
// caller — exactly the case where quietly using our key would put a firm's
// client data in our tenant.
//
// The single legitimate keyless caller is scripts/ingest-planning-kb.ts, which
// embeds our OWN curated library. It opts in by setting __FOUNDRY_SYSTEM_AI,
// read only inside the no-org branch below, so the exception is visible in
// review and cannot reach a firm that has a connection.
import { auth } from "@clerk/nextjs/server";
import { getConnection } from "@/lib/integrations/connections";
import { decodeAzureConfig, decodeAzureSecret, type AiCredentials } from "./credentials";

/** Keeps a repeat AI call from costing a database round trip. Bounded by TTL
 *  rather than invalidation because several serverless instances may hold their
 *  own copy — an explicit clear only reaches the instance that ran the mutation. */
const CACHE_TTL_MS = 60_000;

type CacheEntry = { creds: AiCredentials; expiresAt: number };

/**
 * Keyed by the Clerk org id verbatim. A `Map` keyed on the raw string is the
 * isolation: there is no derived key, no shared slot and no prototype chain, so
 * a lookup for firm B can never reach firm A's entry.
 *
 * ONLY `source: "firm"` entries are stored, and that asymmetry is the point. If
 * a `foundry` answer were cached, a firm that connects its own resource would
 * keep getting OUR key for up to CACHE_TTL_MS from every warm instance that did
 * not run the connect mutation — while their screen already says AI runs in
 * their tenant. That is the precise breach this feature exists to prevent, so
 * an unconnected firm re-reads its (indexed, firmId+provider) row every call
 * instead; a fraction of a millisecond against an AI call costing hundreds.
 *
 * Staleness therefore only ever errs toward the firm's OWN tenant: a disconnect
 * takes up to CACHE_TTL_MS to fall back to ours. That is the safe direction.
 */
const cache = new Map<string, CacheEntry>();

/** Drop cached credentials. Called by connect/disconnect so the acting
 *  instance reflects the change immediately; other instances follow within
 *  CACHE_TTL_MS. Pass no argument to clear every firm (tests). */
export function clearAiCredentialCache(firmId?: string): void {
  // Branch on presence, not truthiness: `clearAiCredentialCache("")` is a
  // caller passing a firm id it failed to populate, not a request to wipe every
  // firm's entry.
  if (firmId !== undefined) cache.delete(firmId);
  else cache.clear();
}

/**
 * Foundry Planning's own Azure resource, from env. Used for firms that have not
 * connected their own, and — explicitly — by the planning-KB ingest script.
 * Throws `ai_not_configured` rather than returning a half-populated object, so
 * a misconfigured deploy fails at the call site instead of as an opaque 401.
 */
export function foundrySystemCredentials(): AiCredentials {
  const endpoint = process.env.AZURE_ENDPOINT ?? "";
  const apiKey = process.env.AZURE_API_KEY ?? "";
  // `||`, not `??`: an env var set to the empty string must take the default
  // rather than survive as "" and build a client that 400s on every call. The
  // siblings below are guarded instead, which `??` would let "" slip past.
  const apiVersion = process.env.AZURE_API_VERSION || "2024-12-01-preview";
  const chat = process.env.AZURE_ANALYSIS_MODEL ?? "";
  const mini = process.env.AZURE_MODEL ?? "";
  const embedding = process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT ?? "";
  if (!endpoint || !apiKey || !chat || !mini) throw new Error("ai_not_configured");
  return Object.freeze({
    source: "foundry",
    endpoint,
    apiKey,
    apiVersion,
    // `embedding` is allowed to be empty here: callAIEmbedding fails closed with
    // ai_embedding_not_configured, and the chat paths must not be blocked by an
    // unset embeddings deployment.
    deployments: Object.freeze({ chat, mini, embedding }),
  } satisfies AiCredentials);
}

/**
 * Reads a connected row into credentials. Every failure surfaces as the
 * `ai_firm_connection_unavailable` sentinel — never a raw ZodError or the
 * codec's own message — so callers branch on a closed set of strings, and so no
 * decoder message can carry key bytes into a log line or a response body. The
 * original is attached as `cause` for server-side diagnosis only.
 */
function firmCredentials(conn: { accessToken: string | null; scope: string | null }): AiCredentials {
  // decodeAzureSecret takes a non-nullable string and has no null guard; an
  // empty blob is a broken row, not a reason to reach for our own key.
  if (!conn.accessToken) throw new Error("ai_firm_connection_unavailable");
  try {
    const { apiKey } = decodeAzureSecret(conn.accessToken);
    const config = decodeAzureConfig(conn.scope);
    // Frozen because this object is what the cache holds: a caller mutating
    // `creds.apiKey` would otherwise corrupt that firm's entry for the whole TTL.
    return Object.freeze({
      source: "firm",
      endpoint: config.endpoint,
      apiKey,
      apiVersion: config.apiVersion,
      deployments: Object.freeze({
        chat: config.chatDeployment,
        mini: config.miniDeployment,
        embedding: config.embeddingDeployment,
      }),
    } satisfies AiCredentials);
  } catch (cause) {
    throw new Error("ai_firm_connection_unavailable", { cause });
  }
}

/**
 * The caller's Clerk org, or null when there isn't one.
 *
 * MEASURED, not assumed: outside a request `auth()` THROWS rather than
 * returning a null org. Under `npx tsx` — the world scripts/ingest-planning-kb.ts
 * runs in, with no request and no clerkMiddleware — it raises `server-only`'s
 * "This module cannot be imported from a Client Component module." Letting that
 * escape would deny the ingest script the no-org branch its own opt-in flag
 * lives in, and break KB ingest.
 *
 * Swallowing the throw is safe in BOTH directions. It cannot soften the
 * compliance promise: an unflagged caller whose org is unreadable still lands
 * in the `!orgId` branch and still throws `ai_no_firm_context`, so a request
 * whose auth() fails transiently never falls back to our key.
 */
async function currentOrgId(): Promise<string | null> {
  try {
    return (await auth()).orgId ?? null;
  } catch {
    return null;
  }
}

/**
 * The firm's credentials if it has connected its own Azure OpenAI resource,
 * Foundry Planning's otherwise. Throws rather than falling back whenever the
 * answer is uncertain — see the module comment.
 */
export async function resolveAiCredentials(): Promise<AiCredentials> {
  const orgId = await currentOrgId();
  if (!orgId) {
    // The sanctioned system caller (scripts/ingest-planning-kb.ts), checked
    // INSIDE this branch and never before it. Checked first, a stray
    // __FOUNDRY_SYSTEM_AI in any server process would route a CONNECTED firm's
    // client data into our tenant — the precise breach this feature exists to
    // prevent. Here it can only ever fill a gap where there is no firm at all.
    if (process.env.__FOUNDRY_SYSTEM_AI === "1") return foundrySystemCredentials();
    throw new Error("ai_no_firm_context");
  }

  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.creds;

  // getConnection decrypts the stored secret inside itself, so a rotated or
  // unset CREDENTIAL_ENCRYPTION_KEY and a malformed envelope both surface here
  // rather than in firmCredentials. A failed read means we cannot know whether
  // this firm is connected, and "cannot know" is never a licence to use our own
  // key — so it throws, under the same sentinel and with the original attached
  // as `cause` rather than concatenated into the message.
  const conn = await getConnection(orgId, "azure_openai").catch((cause: unknown) => {
    throw new Error("ai_firm_connection_unavailable", { cause });
  });

  let creds: AiCredentials;
  if (!conn || conn.status === "disconnected") {
    // No connection at all: the firm never opted into their own tenant, so this
    // is the pre-feature behaviour and the only sanctioned in-app fallback.
    creds = foundrySystemCredentials();
  } else if (conn.status === "connected") {
    creds = firmCredentials(conn);
  } else {
    // `error` today, and the default for any status we do not explicitly know
    // to be safe. The firm opted into their own tenant and it is currently
    // unusable; routing their client data through our tenant instead would
    // break exactly the promise they connected for.
    throw new Error("ai_firm_connection_unavailable");
  }

  // Firm entries only — see the `cache` comment. A foundry answer is recomputed
  // every call so a newly connected firm is never served our key from a warm
  // instance that missed the clear.
  if (creds.source === "firm") {
    cache.set(orgId, { creds, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return creds;
}
