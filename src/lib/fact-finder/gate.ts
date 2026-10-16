// src/lib/fact-finder/gate.ts
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError as SubscriptionForbiddenError } from "@/lib/authz";
import { ForbiddenError, NotFoundError, requireImportAccess } from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit, type ImportRateLimitOp } from "@/lib/rate-limit";
import { refuseUnlessAiImportEntitled } from "@/lib/imports/ai-import-gate";
import { isFactFinderImport } from "@/lib/imports/import-kind";
import type { ImportPayloadJson } from "@/lib/imports/types";
import { SAVE_CLOSED_MESSAGE } from "./api-types";
import { readFactFinderState } from "./state";

export type ImportRow = Awaited<ReturnType<typeof requireImportAccess>>;

export type FactFinderGate =
  | { ok: false; response: Response }
  | {
      ok: true;
      firmId: string;
      userId: string;
      clientId: string;
      importId: string;
      imp: ImportRow;
      payloadJson: ImportPayloadJson;
    };

export function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

const deny = (status: number, error: string, headers?: Record<string, string>): FactFinderGate => ({
  ok: false,
  response: jsonResponse(status, { error }, headers),
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

  const access = await verifyClientAccess(clientId);
  if (!access.ok) return deny(404, "Not found");
  if (access.access !== "own") return deny(403, "Cross-organization imports are not supported.");
  if (access.permission !== "edit") return deny(403, "View-only access");

  const rl = await checkImportRateLimit(firmId, op);
  if (!rl.allowed) {
    const headers: Record<string, string> = {};
    if (rl.reset) headers["Retry-After"] = String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)));
    return deny(rl.reason === "exceeded" ? 429 : 503, RATE_LIMIT_MESSAGES[rl.reason], headers);
  }

  let imp: ImportRow;
  try {
    imp = await requireImportAccess({ importId, clientId, firmId, userId });
  } catch (err) {
    if (err instanceof ForbiddenError) return deny(403, "Forbidden");
    if (err instanceof NotFoundError) return deny(404, err.message);
    throw err;
  }

  const denied = await refuseUnlessAiImportEntitled({ sessionClaims, firmId, clientId, metadata: { importId } });
  if (denied) return { ok: false, response: denied };

  const payloadJson = (imp.payloadJson ?? {}) as ImportPayloadJson;
  if (!isFactFinderImport(payloadJson)) return deny(400, "This import isn't a fact finder import.");

  // A saved import is read-only: only the view (GET) still answers. The refusal
  // carries the saved fact finder, so a screen still open on it (another tab)
  // can switch to the closed view.
  if (payloadJson.factFinder?.closed && op !== "view") {
    return {
      ok: false,
      response: jsonResponse(409, { error: SAVE_CLOSED_MESSAGE, factFinder: readFactFinderState(payloadJson) }),
    };
  }
  // Committed without a saved fact finder: a statement-chat import finished
  // before the switch. The screen shows a notice — there is no fact finder to send.
  if (imp.status === "committed" && op !== "view") return deny(409, SAVE_CLOSED_MESSAGE);

  return { ok: true, firmId, userId, clientId, importId, imp, payloadJson };
}
