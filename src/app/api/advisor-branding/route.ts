import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import {
  getAdvisorProfile,
  upsertAdvisorProfile,
  type BrandFields,
} from "@/lib/branding/advisor-profile";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// A cleared form field arrives as "" (or whitespace), not null/undefined —
// coerce it to null BEFORE validation so `.url()`/`.email()` don't 400 on a
// blank clear. Every brand field is user-clearable. This is the same
// blank-string class of bug Task 10 already fixed once (a stored "" defeated
// a fall-through contract); storing "" here instead of null would re-arm it.
const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

// URL fields get the same "" -> null coercion, plus an explicit trim (a
// whitespace-only value must still collapse to null, not fail validation)
// and a scheme restriction to http(s) only. `website` in particular renders
// as a clickable contact link in the client portal and in client-facing
// PDFs, and a firm admin may set it on ANOTHER advisor's profile — a
// javascript:/data:/vbscript: value would execute on click. Legacy
// `http://` sites are allowed on purpose; only exotic schemes are excluded.
const HTTP_PROTOCOL = /^https?$/;
const trimToNull = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
};
function httpUrlField(max: number) {
  return z.preprocess(
    trimToNull,
    z.string().url({ protocol: HTTP_PROTOCOL }).max(max).nullish(),
  );
}

const brandFieldsSchema = z
  .object({
    brandName: z.preprocess(emptyToNull, z.string().max(120).nullish()),
    logoUrl: httpUrlField(2048),
    faviconUrl: httpUrlField(2048),
    primaryColor: z.preprocess(
      emptyToNull,
      z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
    ),
    contactEmail: z.preprocess(emptyToNull, z.string().email().max(254).nullish()),
    contactPhone: z.preprocess(emptyToNull, z.string().max(40).nullish()),
    website: httpUrlField(2048),
    address: z.preprocess(emptyToNull, z.string().max(500).nullish()),
    emailFromName: z.preprocess(emptyToNull, z.string().max(120).nullish()),
    emailReplyTo: z.preprocess(emptyToNull, z.string().email().max(254).nullish()),
  })
  .strict();

/** `?advisorUserId=` resolves the target; absent/blank/self all mean "me". */
function resolveTarget(req: Request, selfUserId: string): string {
  const raw = new URL(req.url).searchParams.get("advisorUserId")?.trim();
  return raw ? raw : selfUserId;
}

// GET /api/advisor-branding — the caller's own profile, or `?advisorUserId=`
// for a firm admin looking at someone else's.
export async function GET(req: Request): Promise<Response> {
  try {
    const { orgId, userId } = await requireOrgAndUser();
    const target = resolveTarget(req, userId);
    if (target !== userId) {
      await requireOrgAdminOrOwner();
    }
    const profile = await getAdvisorProfile(orgId, target);
    return NextResponse.json({ profile });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/advisor-branding error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/advisor-branding — upsert brand fields. Allowed if EITHER (a) the
// caller is editing their own profile and that profile has brandingEnabled,
// OR (b) the caller is a firm admin (who may edit anyone's, grant on or off —
// an admin can prep a brand before flipping the grant on).
export async function PUT(req: Request): Promise<Response> {
  try {
    const { orgId, userId } = await requireOrgAndUser();
    const target = resolveTarget(req, userId);
    const isSelf = target === userId;

    if (isSelf) {
      const own = await getAdvisorProfile(orgId, userId);
      if (!own?.brandingEnabled) {
        // Self-grant isn't on — only a firm admin may still write it.
        await requireOrgAdminOrOwner();
      }
    } else {
      await requireOrgAdminOrOwner();
    }

    const body = await req.json().catch(() => ({}));
    const parsed = brandFieldsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const row = await upsertAdvisorProfile(
      orgId,
      target,
      parsed.data as Partial<BrandFields>,
      userId,
    );

    await recordAudit({
      action: "advisor_branding.update",
      resourceType: "advisor_profile",
      resourceId: target,
      firmId: orgId,
      // Keys only — the values include contact details (email, phone,
      // address) that don't belong in the audit trail.
      metadata: { fieldsChanged: Object.keys(parsed.data) },
    });

    return NextResponse.json({ profile: row });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/advisor-branding error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
