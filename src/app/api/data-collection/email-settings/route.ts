import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeEmailSettings } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const [row] = await db
      .select()
      .from(intakeEmailSettings)
      .where(and(eq(intakeEmailSettings.firmId, firmId), eq(intakeEmailSettings.userId, userId)));
    return NextResponse.json({
      fromName: row?.fromName ?? null,
      subject: row?.subject ?? null,
      introBody: row?.introBody ?? null,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/data-collection/email-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Empty/blank string → null ("use default"). Cap lengths defensively.
const trimToNull = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => {
      const t = (v ?? "").trim();
      return t.length ? t : null;
    });

const bodySchema = z
  .object({
    fromName: trimToNull(120),
    subject: trimToNull(200),
    introBody: trimToNull(4000),
  })
  .strict();

export async function PUT(request: NextRequest) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
    }
    const { fromName, subject, introBody } = parsed.data;

    await db
      .insert(intakeEmailSettings)
      .values({ firmId, userId, fromName, subject, introBody })
      .onConflictDoUpdate({
        target: [intakeEmailSettings.firmId, intakeEmailSettings.userId],
        set: { fromName, subject, introBody, updatedAt: new Date() },
      });

    await recordAudit({
      action: "intake.email_settings.update",
      resourceType: "intake.email_settings",
      resourceId: `${firmId}:${userId}`,
      firmId,
    });

    return NextResponse.json({ fromName, subject, introBody });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/data-collection/email-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
