import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";

/** Whether the session's org entitlements include `ai_import`. Fails closed. */
export function hasAiImportEntitlement(sessionClaims: unknown): boolean {
  const entitlements = (
    sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null
  )?.org_public_metadata?.entitlements;
  return !!entitlements?.includes("ai_import");
}

/**
 * Every route that runs paid AI document extraction calls this before any DB
 * write or model call. It reads the firm's `ai_import` entitlement from the
 * session claims and fails closed: a missing or stale entitlements array reads
 * as "not entitled". Returns the 403 response to hand back, or null to proceed.
 */
export async function refuseUnlessAiImportEntitled(args: {
  sessionClaims: unknown;
  firmId: string;
  clientId: string;
  metadata?: Record<string, unknown>;
}): Promise<NextResponse | null> {
  if (hasAiImportEntitlement(args.sessionClaims)) return null;

  await recordAudit({
    action: "billing.access_denied",
    resourceType: "firm",
    resourceId: args.firmId,
    clientId: args.clientId,
    firmId: args.firmId,
    metadata: { reason: "ai_import_not_entitled", ...args.metadata },
  });
  return NextResponse.json({ error: "ai_import_not_entitled" }, { status: 403 });
}
