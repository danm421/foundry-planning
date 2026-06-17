import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { parseBody } from "@/lib/schemas/common";
import { requireShareManageAccess } from "@/lib/clients/share-manage";
import { createShare } from "@/lib/clients/share-manage";

export const dynamic = "force-dynamic";

const shareBodySchema = z
  .object({
    email: z.string().email("Must be a valid email"),
    permission: z.enum(["view", "edit"]),
  })
  .strict();

/**
 * POST /api/clients/[id]/shares
 * Share a specific client with another Foundry user. Caller must be the owning
 * advisor or an org:admin of the owning firm (requireShareManageAccess).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireOrgAndUser();
    const { id: clientId } = await params;

    // This enforces: caller in owning firm AND (owner OR admin)
    const { firmId, ownerUserId } = await requireShareManageAccess(clientId);

    const parsed = await parseBody(shareBodySchema, request);
    if (!parsed.ok) return parsed.response;
    const { email, permission } = parsed.data;

    const result = await createShare({
      scope: "client",
      email,
      permission,
      firmId,
      ownerUserId,
      clientId,
      actorId: userId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ share: result.share }, { status: 201 });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return NextResponse.json(authErr.body, { status: authErr.status });
    console.error("POST /api/clients/[id]/shares error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
