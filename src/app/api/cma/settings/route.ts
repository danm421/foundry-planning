import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cmaSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const firmId = await requireOrgId();
    const [row] = await db
      .select()
      .from(cmaSettings)
      .where(eq(cmaSettings.firmId, firmId));

    return NextResponse.json({ riskFreeRate: row ? parseFloat(row.riskFreeRate) : 0.04 });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /api/cma/settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const settingsBodySchema = z
  .object({
    riskFreeRate: z.coerce.number().min(0).max(0.2),
  })
  .strict();

export async function PUT(request: NextRequest) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();

    const parsed = settingsBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
    }
    const { riskFreeRate } = parsed.data;

    await db
      .insert(cmaSettings)
      .values({ firmId, riskFreeRate: String(riskFreeRate) })
      .onConflictDoUpdate({
        target: cmaSettings.firmId,
        set: { riskFreeRate: String(riskFreeRate), updatedAt: new Date() },
      });

    await recordAudit({
      action: "cma.settings.update",
      resourceType: "cma.settings",
      resourceId: firmId,
      firmId,
      metadata: { riskFreeRate },
    });

    return NextResponse.json({ riskFreeRate });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/cma/settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
