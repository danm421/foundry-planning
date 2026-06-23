import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  extractClientIp,
  checkIntakeSubmitRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { loadFormByToken } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import {
  intakeDraftSchema,
  intakeSubmitSchema,
  type IntakePayload,
} from "@/lib/intake/schema";
import { requireActiveSubscriptionForFirm, ForbiddenError } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/intake/[token]/submit — public (no auth), token-scoped.
// Validates the complete draft payload and freezes the form to "submitted"
// for advisor review. Never writes live plan data — only `applyIntake` does.
//
// Race-free submit: an optional JSON body is accepted and merged into the
// stored payload before strict validation. This eliminates the race where
// the last debounced autosave hasn't landed before the client hits Submit.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Rate limiting (keyed on token:ip)
  const ip = extractClientIp(req);
  const rl = await checkIntakeSubmitRateLimit(`${token}:${ip}`);
  if (!rl.allowed) {
    return rateLimitErrorResponse(rl, "Too many submit requests. Please slow down.");
  }

  // 2. Load form
  const form = await loadFormByToken(token);
  if (!form) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3. Expiry check
  if (isExpired(form, new Date())) {
    return NextResponse.json({ error: "This form link has expired." }, { status: 410 });
  }

  // 4. Status guard (only draft forms can be submitted)
  if (form.status !== "draft") {
    return NextResponse.json(
      { error: "This form has already been submitted." },
      { status: 409 },
    );
  }

  // 5. Race-free finalize: merge an optional last-draft body into the stored
  //    payload before strict validation. This covers the common case where the
  //    wizard fires Submit while the final debounced autosave is still in flight.
  let finalPayload: unknown = form.payload ?? {};

  const contentType = req.headers.get("content-type") ?? "";
  const hasBody = contentType.includes("application/json");
  if (hasBody) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Validate the body loosely (draft schema) — rejects garbage, allows
    // partial drafts so an in-progress wizard can still include the last section.
    let parsedDraft: ReturnType<typeof intakeDraftSchema.parse>;
    try {
      parsedDraft = intakeDraftSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid payload", issues: err.issues },
          { status: 422 },
        );
      }
      throw err;
    }

    // Persist the merged draft so the DB row matches what we validate below.
    const merged = {
      ...(form.payload ?? {}),
      ...parsedDraft,
    } as unknown as IntakePayload;

    await db
      .update(intakeForms)
      .set({ payload: merged, updatedAt: new Date() })
      .where(eq(intakeForms.id, form.id));

    finalPayload = merged;
  }

  // 6. Firm-active gate (checked AFTER merge so we don't block a mid-flow
  //    firm on a transient subscription lapse just because the payload arrived
  //    in two parts; the submission still belongs to the firm's account).
  try {
    await requireActiveSubscriptionForFirm(form.firmId);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Subscription inactive." }, { status: 403 });
    }
    throw e;
  }

  // 7. Strict validation — the merged draft must now be complete.
  let validatedPayload: ReturnType<typeof intakeSubmitSchema.parse>;
  try {
    validatedPayload = intakeSubmitSchema.parse(finalPayload);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Incomplete form — please fill in all required fields.", issues: err.issues },
        { status: 422 },
      );
    }
    throw err;
  }

  // 8. Freeze the form: persist the validated (coerced) payload + flip status.
  const submittedAt = new Date();
  await db
    .update(intakeForms)
    .set({
      status: "submitted",
      submittedAt,
      payload: validatedPayload,
      updatedAt: submittedAt,
    })
    .where(eq(intakeForms.id, form.id));

  // 9. Audit — actorKind:"client" because the prospect/client is the submitter,
  //    not an advisor. actorId falls back to "system" (no Clerk session in the
  //    public flow), which is correct since there is no authenticated actor here.
  await recordAudit({
    action: "intake.form.submitted",
    actorKind: "client",
    actorId: "system", // no Clerk session on the public intake flow
    firmId: form.firmId,
    clientId: form.clientId ?? null,
    resourceType: "intake_form",
    resourceId: form.id,
  });

  return NextResponse.json({ ok: true });
}
