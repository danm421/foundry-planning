import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientShares } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { parseBody } from "@/lib/schemas/common";
import { resolveSharesForRecipient } from "@/lib/clients/shared-access";
import { createShare } from "@/lib/clients/share-manage";

export const dynamic = "force-dynamic";

const shareBodySchema = z
  .object({
    email: z.string().email("Must be a valid email"),
    permission: z.enum(["view", "edit"]),
  })
  .strict();

/**
 * POST /api/shares
 * The caller shares their own book (scope:"all", clientId:null) with another
 * Foundry user by email. Returns 201 on success or an error status.
 */
export async function POST(request: NextRequest) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();

    const parsed = await parseBody(shareBodySchema, request);
    if (!parsed.ok) return parsed.response;
    const { email, permission } = parsed.data;

    const result = await createShare({
      scope: "all",
      email,
      permission,
      firmId,
      ownerUserId: userId,
      clientId: null,
      actorId: userId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ share: result.share }, { status: 201 });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return NextResponse.json(authErr.body, { status: authErr.status });
    console.error("POST /api/shares error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/shares?direction=outgoing|incoming
 *
 * outgoing (default): non-revoked shares the caller (or their firm, for admins)
 *   has created, enriched with recipient email.
 * incoming: all effective shares the caller receives from other firms, enriched
 *   with owner user id and firm id (from the share row — no extra Clerk lookup
 *   in the MVP; UI can fetch member names separately).
 */
export async function GET(request: NextRequest) {
  try {
    const { orgId, userId } = await requireOrgAndUser();
    const { orgRole } = await auth();
    const direction = request.nextUrl.searchParams.get("direction") ?? "outgoing";

    if (direction === "incoming") {
      const shares = await resolveSharesForRecipient(userId);
      return NextResponse.json({ shares });
    }

    // outgoing — admins see the whole firm's book; advisors see only their own
    const isAdmin = orgRole === "org:admin";
    const ownerFilter = isAdmin
      ? eq(clientShares.firmId, orgId)
      : and(eq(clientShares.ownerUserId, userId), eq(clientShares.firmId, orgId));

    const rows = await db
      .select()
      .from(clientShares)
      .where(and(ownerFilter, isNull(clientShares.revokedAt)));

    return NextResponse.json({ shares: rows });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return NextResponse.json(authErr.body, { status: authErr.status });
    console.error("GET /api/shares error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
