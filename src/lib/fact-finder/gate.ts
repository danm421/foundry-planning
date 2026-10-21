// src/lib/fact-finder/gate.ts
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError as SubscriptionForbiddenError } from "@/lib/authz";
import { ForbiddenError, NotFoundError, requireImportAccess } from "@/lib/imports/authz";
import { verifyClientAccess, verifyClientAccessFor, type ClientAccessCheck } from "@/lib/clients/authz";
import { checkImportRateLimit, type ImportRateLimitOp } from "@/lib/rate-limit";
import { hasAiImportEntitlement, recordAiImportDenied } from "@/lib/imports/ai-import-gate";
import { isFactFinderImport, isFinishedInStatementChat, isSavedFactFinder } from "@/lib/imports/import-kind";
import { savedFactFinderBody } from "@/lib/imports/saved-fact-finder";
import type { ImportPayloadJson } from "@/lib/imports/types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { SAVE_CLOSED_MESSAGE } from "./api-types";
import type { FactFinderState } from "./types";

export type ImportRow = Awaited<ReturnType<typeof requireImportAccess>>;

type FactFinderAllowed = {
  ok: true;
  firmId: string;
  userId: string;
  clientId: string;
  importId: string;
  imp: ImportRow;
  payloadJson: ImportPayloadJson;
};

/** What the gate chain decides, before either doorway turns a refusal into its own answer. */
export type FactFinderAccess =
  | FactFinderAllowed
  | { ok: false; status: number; body: { error: string; factFinder?: FactFinderState }; headers?: Record<string, string> };

/** A refusal from the chain, as a status and body either doorway turns into its own answer. */
export type FactFinderRefusal = Extract<FactFinderAccess, { ok: false }>;

export type FactFinderGate = { ok: false; response: Response } | FactFinderAllowed;

export function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

const deny = (status: number, error: string): FactFinderGate => ({ ok: false, response: jsonResponse(status, { error }) });

const refuse = (status: number, error: string, headers?: Record<string, string>): FactFinderRefusal => ({
  ok: false,
  status,
  body: { error },
  ...(headers && { headers }),
});

const RATE_LIMIT_MESSAGES = {
  unconfigured: "Rate limiting is not configured — the fact finder import is disabled.",
  redis_error: "Rate limiting is temporarily unavailable. Please retry in a moment.",
  exceeded: "Too many requests. Please wait a moment and try again.",
} as const;

/**
 * The gate chain every fact finder route runs, in order: org → subscription →
 * auth → client access → rate limit (fails closed) → import ownership →
 * `ai_import` entitlement → "is a fact finder import" → "not saved yet" (a
 * saved import, or one finished in statement chat, answers only `view`). All of it resolves
 * before a route does any work, so an SSE route can open its stream after.
 */
export async function factFinderGate(
  paramsPromise: Promise<{ id: string; importId: string }>,
  op: ImportRateLimitOp,
): Promise<FactFinderGate> {
  let firmId: string;
  let userId: string;
  let sessionClaims: unknown;
  try {
    firmId = await requireOrgId();
    await requireActiveSubscription();
    const session = await auth();
    if (!session.userId) throw new UnauthorizedError();
    userId = session.userId;
    sessionClaims = session.sessionClaims;
  } catch (err) {
    if (err instanceof UnauthorizedError) return deny(401, "Unauthorized");
    if (err instanceof SubscriptionForbiddenError) return deny(403, err.message);
    throw err;
  }

  const { id: clientId, importId } = await paramsPromise;

  const gate = await factFinderAccess({
    firmId,
    userId,
    clientId,
    importId,
    op,
    access: await verifyClientAccess(clientId),
    aiImportEntitled: hasAiImportEntitlement(sessionClaims),
    deniedAudit: () => recordAiImportDenied({ firmId, clientId, metadata: { importId } }),
  });
  return gate.ok ? gate : { ok: false, response: jsonResponse(gate.status, gate.body, gate.headers) };
}

/**
 * The Claude connector's doorway: the same chain, with the user, the firm and
 * the `ai_import` entitlement read from the principal — its call has no Clerk
 * session. Billing is not checked here: the MCP tool runner refuses a write on
 * `principal.canWrite`.
 */
export async function factFinderGateFor(
  principal: McpPrincipal,
  clientId: string,
  importId: string,
  op: ImportRateLimitOp,
): Promise<FactFinderAccess> {
  return factFinderAccess({ ...(await connectorCaller(principal, clientId, { importId })), clientId, importId, op });
}

/**
 * Before the connector creates a fact finder import: the chain's own-client and
 * `ai_import` refusals, the ones that need no import — same answers, same
 * refused-entitlement audit. A refusal means nothing should be created.
 */
export async function factFinderCreateCheckFor(
  principal: McpPrincipal,
  clientId: string,
): Promise<{ ok: true } | FactFinderRefusal> {
  const caller = await connectorCaller(principal, clientId, {});
  return (
    clientRefusal(caller.access, caller.firmId) ??
    (await entitlementRefusal(caller.aiImportEntitled, caller.deniedAudit)) ?? { ok: true }
  );
}

/**
 * Before the connector creates a household, which has no client yet: the
 * `ai_import` refusal alone, with the same answer and audit as the chain's.
 */
export async function aiImportCheckFor(principal: McpPrincipal): Promise<{ ok: true } | FactFinderRefusal> {
  const refused = await entitlementRefusal(principal.entitlements.includes("ai_import"), () =>
    recordAiImportDenied({ firmId: principal.orgId, actorId: principal.userId, metadata: { via: "claude" } }),
  );
  return refused ?? { ok: true };
}

/** The connector's caller as the chain reads it: firm, user and entitlement from the principal, never a session. */
async function connectorCaller(principal: McpPrincipal, clientId: string, auditMetadata: Record<string, unknown>) {
  const firmId = principal.orgId;
  return {
    firmId,
    userId: principal.userId,
    access: await verifyClientAccessFor(principal, clientId),
    aiImportEntitled: principal.entitlements.includes("ai_import"),
    deniedAudit: () =>
      recordAiImportDenied({ firmId, clientId, actorId: principal.userId, metadata: { ...auditMetadata, via: "claude" } }),
  };
}

/**
 * The client checks every doorway runs first: found, the caller's own firm, edit
 * permission. A teammate's edit share inside the same firm passes — only a client
 * owned by another firm is refused.
 */
function clientRefusal(access: ClientAccessCheck, firmId: string): FactFinderRefusal | null {
  if (!access.ok) return refuse(404, "Not found");
  if (access.firmId !== firmId) return refuse(403, "Cross-organization imports are not supported.");
  if (access.permission !== "edit") return refuse(403, "View-only access");
  return null;
}

/** The `ai_import` entitlement; a refusal is audited. */
async function entitlementRefusal(entitled: boolean, deniedAudit: () => Promise<void>): Promise<FactFinderRefusal | null> {
  if (entitled) return null;
  await deniedAudit();
  return refuse(403, "ai_import_not_entitled");
}

/**
 * The chain after the caller is known: client access → rate limit → import
 * ownership → entitlement (`deniedAudit` records a refusal) → "is a fact
 * finder import" → "not saved yet".
 */
async function factFinderAccess(args: {
  firmId: string;
  userId: string;
  clientId: string;
  importId: string;
  op: ImportRateLimitOp;
  access: ClientAccessCheck;
  aiImportEntitled: boolean;
  deniedAudit: () => Promise<void>;
}): Promise<FactFinderAccess> {
  const { firmId, userId, clientId, importId, op } = args;

  const clientRefused = clientRefusal(args.access, firmId);
  if (clientRefused) return clientRefused;

  const rl = await checkImportRateLimit(firmId, op);
  if (!rl.allowed) {
    const headers: Record<string, string> = {};
    if (rl.reset) headers["Retry-After"] = String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)));
    return refuse(rl.reason === "exceeded" ? 429 : 503, RATE_LIMIT_MESSAGES[rl.reason], headers);
  }

  let imp: ImportRow;
  try {
    imp = await requireImportAccess({ importId, clientId, firmId, userId });
  } catch (err) {
    if (err instanceof ForbiddenError) return refuse(403, "Forbidden");
    if (err instanceof NotFoundError) return refuse(404, err.message);
    throw err;
  }

  const entitlementRefused = await entitlementRefusal(args.aiImportEntitled, args.deniedAudit);
  if (entitlementRefused) return entitlementRefused;

  const payloadJson = (imp.payloadJson ?? {}) as ImportPayloadJson;
  if (!isFactFinderImport(payloadJson)) return refuse(400, "This import isn't a fact finder import.");

  if (op !== "view") {
    // A saved import is read-only: only the view (GET) still answers. The refusal
    // carries the saved fact finder, so a screen still open on it (another tab)
    // can switch to the closed view.
    if (isSavedFactFinder(payloadJson)) return { ok: false, status: 409, body: savedFactFinderBody(payloadJson) };
    // Finished in statement chat: the screen shows a notice — there is no fact finder to send.
    if (isFinishedInStatementChat(imp.status, payloadJson)) return refuse(409, SAVE_CLOSED_MESSAGE);
  }

  return { ok: true, firmId, userId, clientId, importId, imp, payloadJson };
}
