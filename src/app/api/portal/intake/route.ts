import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, intakeForms } from "@/db/schema";
import { requireClientPortalAccess, authErrorResponse, ForbiddenError } from "@/lib/authz";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { loadActivePrefilledForm } from "@/lib/intake/queries";
import { loadOrSeedPortalIntakeForm } from "@/lib/intake/load-or-seed";
import { sectionsForForm } from "@/lib/intake/sections";
import {
  intakeDraftSchema,
  intakeSubmitSchemaFor,
  pruneIntakeBlankRows,
  type IntakePayload,
} from "@/lib/intake/schema";
import { recordAudit } from "@/lib/audit";
import { notifyIntakeSubmitted } from "@/lib/notifications/producers/intake";

export const dynamic = "force-dynamic";

// ── Shared auth chain ─────────────────────────────────────────────────────────

async function resolveAuth(): Promise<{
  clientId: string;
  firmId: string;
  advisorId: string;
}> {
  const { clientId } = await requireClientPortalAccess();
  await requirePortalActiveSubscription(clientId);

  // advisorId rides along on the row we already load for firmId — POST needs it
  // to address the submit notification, and re-selecting the same row would be
  // a second round trip for a column that is right here.
  const [clientRow] = await db
    .select({ firmId: clients.firmId, advisorId: clients.advisorId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!clientRow) {
    throw new ForbiddenError("client not found");
  }

  return { clientId, firmId: clientRow.firmId, advisorId: clientRow.advisorId };
}

// ── GET — seed/load ───────────────────────────────────────────────────────────
//
// Loads the active prefilled form for the authenticated portal client.
// If the stored payload is empty ({} — the column default), lazily seeds it
// from the client's live planning data via snapshotClientToPayload, persists
// the seed, and returns it. Otherwise returns the stored payload.
//
// Auth chain: requireClientPortalAccess → requirePortalActiveSubscription
// (NO requireEditEnabled — intake is its own gated surface)

export async function GET(): Promise<Response> {
  try {
    const { clientId, firmId } = await resolveAuth();

    const result = await loadOrSeedPortalIntakeForm(clientId, firmId);
    if (!result) {
      return NextResponse.json({ error: "No active intake form" }, { status: 404 });
    }

    return NextResponse.json({ payload: result.payload, status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

// ── PATCH — autosave ──────────────────────────────────────────────────────────
//
// Merges a partial draft (intakeDraftSchema) into the stored payload.
// Only allowed when status === "draft" (else 409 Conflict).
// No audit — autosave is high-frequency; noise would drown the log.

export async function PATCH(req: Request): Promise<Response> {
  try {
    const { clientId } = await resolveAuth();

    const form = await loadActivePrefilledForm(clientId);
    if (!form) {
      return NextResponse.json({ error: "No active intake form" }, { status: 404 });
    }

    if (form.status !== "draft") {
      return NextResponse.json(
        { error: "This form has already been submitted." },
        { status: 409 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

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

    const merged = {
      ...(form.payload ?? {}),
      ...parsedDraft,
    } as unknown as IntakePayload;

    await db
      .update(intakeForms)
      .set({ payload: merged, updatedAt: new Date() })
      .where(eq(intakeForms.id, form.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

// ── POST — submit ─────────────────────────────────────────────────────────────
//
// Race-free submit: an optional JSON body is accepted and merged into the
// stored payload before strict validation (eliminates the race where the last
// debounced autosave hasn't landed before the client hits Submit).
//
// On success: status → "submitted", submittedAt set, audit written, and the
// owning advisor notified (best-effort, after the write commits).

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, firmId, advisorId } = await resolveAuth();

    const form = await loadActivePrefilledForm(clientId);
    if (!form) {
      return NextResponse.json({ error: "No active intake form" }, { status: 404 });
    }

    if (form.status !== "draft") {
      return NextResponse.json(
        { error: "This form has already been submitted." },
        { status: 409 },
      );
    }

    // Race-free finalize: merge an optional last-draft body into the stored payload
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

    // Strict validation — the merged draft must now be complete, against the
    // sections THIS form actually collects. Drop optional rows added but left
    // blank so they don't read as incomplete required fields.
    const sections = sectionsForForm(form.sections);
    let validatedPayload: IntakePayload;
    try {
      validatedPayload = intakeSubmitSchemaFor(sections).parse(
        pruneIntakeBlankRows(finalPayload),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Incomplete form — please fill in all required fields.", issues: err.issues },
          { status: 422 },
        );
      }
      throw err;
    }

    // Freeze the form
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

    // Audit — actorKind:"client" because the portal user is the submitter
    await recordAudit({
      action: "intake.form.submitted",
      actorKind: "client",
      actorId: clientId,
      firmId,
      clientId,
      resourceType: "intake_form",
      resourceId: form.id,
    });

    // Tell the owning advisor. Deliberately AFTER the update above has
    // committed and outside any transaction (this handler opens none) — an
    // enqueue failure must never roll back a client's submission.
    // clientId/advisorId come from resolveAuth, so both are non-null here:
    // loadActivePrefilledForm matches on `clientId` (SQL `=` never matches
    // NULL) and filters mode="prefilled", so the nullable-clientId guard its
    // sibling site needs would be dead code here.
    // This route only ever serves a signed-in portal client. Prospect and
    // blank-mode submissions arrive on the emailed token link instead and are
    // handled — and notified — by src/app/api/intake/[token]/submit/route.ts,
    // which DOES need that guard because a blank invite can carry no client.
    await notifyIntakeSubmitted({
      firmId,
      advisorId,
      clientId,
      formId: form.id,
      recipientName: form.recipientName,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
