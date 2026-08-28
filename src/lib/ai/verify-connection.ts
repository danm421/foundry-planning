// src/lib/ai/verify-connection.ts
//
// "Test connection" for a firm's own Azure OpenAI resource. Three real
// rehearsals rather than a ping, because each one guards a failure that would
// otherwise surface days later in production:
//
//   chat      — Forge and every AI draft need structured output AND tool calls.
//               A deployment that answers "hello" but cannot tool-call would
//               pass a naive check and break the assistant.
//   mini      — same, for narration and meeting prep.
//   embedding — the one that fails SILENTLY. planning_kb_chunks holds Foundry
//               Planning's global curated library and each firm's own notes in
//               ONE 1536-dim vector space, and searchPlanningKb queries both
//               with a single ORDER BY (src/domain/forge/tools/knowledge.ts).
//               A different embedding model yields correct dimensions, no
//               error, and Forge answers assembled from semantically unrelated
//               chunks. We embed a fixed phrase in both tenants and compare.
//
// Nothing here throws: each check returns a structured result so an admin
// learns WHICH deployment is wrong, and so a route handler has nothing to
// translate.
import { AzureOpenAI } from "openai";
import { azureClientOptions } from "./client";
import { foundrySystemCredentials } from "./resolve";
import type { AiCredentials } from "./credentials";

export type ConnectionCheck = {
  name: "chat" | "mini" | "embedding";
  ok: boolean;
  detail?: string;
};
export type VerifyResult = { ok: boolean; checks: ConnectionCheck[] };

/** Fixed, non-client text. Changing it changes nothing about correctness — both
 *  vectors are embedded from this same constant inside one invocation, and no
 *  derived vector is persisted. It says "Foundry Planning", not "Foundry":
 *  this sentence lands in the FIRM's own Azure OpenAI request logs, where it is
 *  read with none of our UI around it and a bare "Foundry" is ambiguous with
 *  Microsoft Foundry. If a reference vector is ever cached rather than computed
 *  live, this constant becomes load-bearing and changing it stops being free. */
export const EMBEDDING_PROBE =
  "Foundry Planning embedding compatibility probe. This sentence is not client data.";

/**
 * How close the firm's probe vector must sit to ours before we accept that both
 * deployments run the same embedding model.
 *
 * UNMEASURED — this is a starting estimate, not an observation. Foundry
 * Planning has no embedding deployment configured:
 * AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT is absent from .env.local and from
 * production, so there is no reference vector to measure against and no
 * same-model baseline on record.
 * The reasoning behind 0.99: one model embedding one fixed string in two
 * tenants should differ only by serving-side float noise, which lands far
 * inside a hundredth; two different models land near-orthogonal. Anything in
 * between is exactly the ambiguity this check refuses.
 *
 * What would change it: run scripts/measure-embedding-probe.local.ts once an
 * embedding deployment exists. If the same-model similarity measures BELOW
 * 0.99, raise the tolerance to just under the observed value and record the
 * measurement here. Never lower it toward an observed different-model value.
 */
export const MIN_EMBEDDING_COSINE = 0.99;

const EXPECTED_DIM = 1536;

export function cosineSimilarity(a: number[], b: number[]): number {
  // Returning 0 rather than NaN on degenerate input is load-bearing:
  // `NaN < MIN_EMBEDDING_COSINE` is FALSE, so a NaN would let an empty or
  // zero-length reference vector PASS the compatibility check silently.
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Error text goes in front of an admin, and an Azure SDK message can echo the
 *  request. Never let a key through. */
function safeDetail(err: unknown, secrets: string[]): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const s of secrets) {
    if (s) msg = msg.split(s).join("***");
  }
  return msg.slice(0, 300);
}

function clientFor(creds: AiCredentials): AzureOpenAI {
  return new AzureOpenAI(azureClientOptions(creds));
}

const PING_TOOL = {
  type: "function" as const,
  function: {
    name: "ping",
    description: "Acknowledge readiness. Always call this exactly once.",
    parameters: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
  },
};

async function checkChat(
  creds: AiCredentials,
  which: "chat" | "mini",
): Promise<ConnectionCheck> {
  // Indexed, not a ternary: `which` is already a key of AiDeployments, so the
  // check cannot address the wrong deployment even by a typo.
  const deployment = creds.deployments[which];
  try {
    const response = await clientFor(creds).chat.completions.create({
      model: deployment,
      messages: [
        { role: "system", content: "You are verifying a deployment. Call the ping tool." },
        { role: "user", content: "ping" },
      ],
      tools: [PING_TOOL],
      max_completion_tokens: 256,
    });
    const message = response.choices[0]?.message;
    if (!message) {
      return { name: which, ok: false, detail: `${deployment} returned no message.` };
    }
    if (!message.tool_calls || message.tool_calls.length === 0) {
      // The whole reason this check is not a ping. A deployment that answers in
      // prose but cannot tool-call passes every naive test and then breaks
      // Forge on the firm's first real question.
      return {
        name: which,
        ok: false,
        detail: `${deployment} answered but did not make a tool call. Foundry Planning needs a deployment that supports tool calling.`,
      };
    }
    return { name: which, ok: true };
  } catch (err) {
    return { name: which, ok: false, detail: safeDetail(err, [creds.apiKey]) };
  }
}

async function checkEmbedding(creds: AiCredentials): Promise<ConnectionCheck> {
  const deployment = creds.deployments.embedding;
  if (!deployment) {
    return { name: "embedding", ok: false, detail: "No embedding deployment name was provided." };
  }
  let candidate: number[];
  try {
    const res = await clientFor(creds).embeddings.create({
      model: deployment,
      input: EMBEDDING_PROBE,
    });
    candidate = res.data[0]?.embedding ?? [];
  } catch (err) {
    return { name: "embedding", ok: false, detail: safeDetail(err, [creds.apiKey]) };
  }

  if (candidate.length !== EXPECTED_DIM) {
    // Rejected on its own evidence — no reference call, so a plainly wrong
    // deployment costs nothing in our tenant.
    return {
      name: "embedding",
      ok: false,
      detail: `${deployment} returns ${candidate.length}-dimension vectors; Foundry Planning's knowledge base requires ${EXPECTED_DIM}.`,
    };
  }

  // Reference vector from Foundry Planning's own tenant, computed live so it can
  // never drift from whatever model we are actually running. Resolved OUTSIDE
  // the network try/catch so its own `ai_not_configured` throw gets an
  // admin-readable answer rather than a raw sentinel.
  let foundry: AiCredentials;
  try {
    foundry = foundrySystemCredentials();
  } catch {
    return {
      name: "embedding",
      ok: false,
      detail:
        "Foundry Planning's own Azure OpenAI resource is not configured, so embedding " +
        "compatibility cannot be verified. Contact Foundry Planning support.",
    };
  }
  if (!foundry.deployments.embedding) {
    // Deliberately a FAILURE, not a warning or a pass. Without a reference
    // vector we cannot tell a compatible model from an incompatible one, and
    // "cannot verify, so allow" is the precise silent-failure hole this check
    // exists to close.
    return {
      name: "embedding",
      ok: false,
      detail:
        "Foundry Planning's own embedding deployment is unset, so compatibility " +
        "cannot be verified. Contact Foundry Planning support.",
    };
  }

  let reference: number[];
  try {
    const res = await clientFor(foundry).embeddings.create({
      model: foundry.deployments.embedding,
      input: EMBEDDING_PROBE,
    });
    reference = res.data[0]?.embedding ?? [];
  } catch (err) {
    // BOTH keys. This call runs in OUR tenant with OUR key, and an Azure SDK
    // message can echo the request that carried it — so redacting only the
    // firm's key would hand Foundry Planning's own credential to every admin
    // who clicks Test connection.
    return {
      name: "embedding",
      ok: false,
      detail: safeDetail(err, [foundry.apiKey, creds.apiKey]),
    };
  }

  const similarity = cosineSimilarity(candidate, reference);
  if (similarity < MIN_EMBEDDING_COSINE) {
    return {
      name: "embedding",
      ok: false,
      detail:
        `${deployment} appears to be a different model from the one Foundry Planning's knowledge base ` +
        `was built with (similarity ${similarity.toFixed(3)}). Forge search would return unrelated ` +
        `results with no error. Deploy the embedding model named in the setup steps.`,
    };
  }
  return { name: "embedding", ok: true };
}

/** Runs all three checks and reports each one, so an admin learns WHICH
 *  deployment is wrong rather than that "something" failed. */
export async function verifyAzureConnection(creds: AiCredentials): Promise<VerifyResult> {
  const chat = await checkChat(creds, "chat");
  const mini = await checkChat(creds, "mini");
  const embedding = await checkEmbedding(creds);
  const checks = [chat, mini, embedding];
  return { ok: checks.every((c) => c.ok), checks };
}
