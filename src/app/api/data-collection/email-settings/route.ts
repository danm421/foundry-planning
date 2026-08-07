import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeEmailSettings } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { normalizeSections, type IntakeSectionKey } from "@/lib/intake/sections";

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
      sections: row?.sections ?? null,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/data-collection/email-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Empty/blank string → null ("use default"). Absent → undefined, which this
// route treats as "leave the stored value alone". Cap lengths defensively.
const trimToNull = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const t = v.trim();
      return t.length ? t : null;
    });

const bodySchema = z
  .object({
    fromName: trimToNull(120),
    subject: trimToNull(200),
    introBody: trimToNull(4000),
    sections: z.array(z.string().max(40)).nullable().optional(),
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

    // Explicit null → "use the system default", stored as NULL. A present array
    // is normalized; one that normalizes to nothing is a request for a form that
    // collects nothing. Absent stays undefined and is left alone below.
    let sections: IntakeSectionKey[] | null | undefined;
    if (parsed.data.sections === null) {
      sections = null;
    } else if (parsed.data.sections !== undefined) {
      sections = normalizeSections(parsed.data.sections);
      if (sections.length === 0) {
        return NextResponse.json(
          { error: "A form must collect at least one section" },
          { status: 400 },
        );
      }
    }

    // PARTIAL UPDATE, not a full replace: only the keys the caller actually
    // sent are written. This page has TWO independent cards (invitation email,
    // form steps) posting to this one row — under full-replace semantics,
    // saving either one silently wipes the other's column, and no amount of
    // client-side GET-then-merge makes that safe for the next card someone
    // adds. Clearing a field is still possible, it just has to be said out
    // loud: "" for the text fields, null for sections.
    const patch = {
      ...(fromName !== undefined ? { fromName } : {}),
      ...(subject !== undefined ? { subject } : {}),
      ...(introBody !== undefined ? { introBody } : {}),
      ...(sections !== undefined ? { sections } : {}),
    };

    const [saved] = await db
      .insert(intakeEmailSettings)
      .values({
        firmId,
        userId,
        fromName: fromName ?? null,
        subject: subject ?? null,
        introBody: introBody ?? null,
        sections: sections ?? null,
      })
      .onConflictDoUpdate({
        target: [intakeEmailSettings.firmId, intakeEmailSettings.userId],
        set: { ...patch, updatedAt: new Date() },
      })
      .returning();

    await recordAudit({
      action: "intake.email_settings.update",
      resourceType: "intake.email_settings",
      resourceId: `${firmId}:${userId}`,
      firmId,
    });

    // Echo what was STORED, not what was sent — under partial semantics those
    // differ for every key the caller omitted.
    return NextResponse.json({
      fromName: saved.fromName,
      subject: saved.subject,
      introBody: saved.introBody,
      sections: saved.sections ?? null,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/data-collection/email-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
