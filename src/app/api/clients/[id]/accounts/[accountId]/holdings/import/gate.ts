import type { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { checkImportRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";

/**
 * What every Holdings-tab import route checks first: the caller may edit this
 * client, the client's firm is subscribed, and the account is the client's.
 * Null when the account isn't — the route answers 404.
 */
export async function holdingsImportGate(clientId: string, accountId: string) {
  const callerOrg = await requireOrgId();
  const { firmId, access } = await requireClientEditAccess(clientId);
  await requireActiveSubscriptionForFirm(firmId);
  const [account] = await db
    .select({ id: accounts.id, last4: accounts.accountNumberLast4 })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));
  return account ? { callerOrg, firmId, access, account } : null;
}

/** The import limiter's refusal as a response, or null to go ahead. Fails closed without Upstash. */
export async function refuseOverImportLimit(
  callerOrg: string,
  op: "extract" | "commit",
): Promise<NextResponse | null> {
  const rl = await checkImportRateLimit(callerOrg, op);
  if (rl.allowed) return null;
  return rateLimitErrorResponse(
    rl,
    rl.reason === "exceeded"
      ? "Too many import requests. Please wait a minute and try again."
      : rl.reason === "redis_error"
        ? "Rate limiting is temporarily unavailable. Please retry in a moment."
        : "Rate limiting is not configured — imports are disabled.",
  );
}
