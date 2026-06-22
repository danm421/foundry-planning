import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, intakeForms } from "@/db/schema";
import { requireClientPortalAccess, authErrorResponse, ForbiddenError } from "@/lib/authz";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { loadActivePrefilledForm } from "@/lib/intake/queries";
import { snapshotClientToPayload } from "@/lib/intake/snapshot";
import {
  intakeDraftSchema,
  intakeSubmitSchema,
  type IntakePayload,
} from "@/lib/intake/schema";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// ── Shared auth chain ─────────────────────────────────────────────────────────

async function resolveAuth(): Promise<{ clientId: string; firmId: string }> {
  const { clientId } = await requireClientPortalAccess();
  await requirePortalActiveSubscription(clientId);

  const [clientRow] = await db
    .select({ firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!clientRow) {
    throw new ForbiddenError("client not found");
  }

  return { clientId, firmId: clientRow.firmId };
}

// ── GET — seed/load ───────────────────────────────────────────────────────────
//
// Loads the active prefilled form for the authenticated portal client.
// If the stored payload is empty ({} / no `family`), lazily seeds it from the
// client's live planning data via snapshotClientToPayload, persists the seed,
// and returns it. Otherwise returns the stored payload.
//
// Auth chain: requireClientPortalAccess → requirePortalActiveSubscription
// (NO requireEditEnabled — intake is its own gated surface)

export async function GET(): Promise<Response> {
  try {
    const { clientId, firmId } = await resolveAuth();

    const form = await loadActivePrefilledForm(clientId);
    if (!form) {
      return NextResponse.json({ error: "No active intake form" }, { status: 404 });
    }

    const payload = form.payload as IntakePayload | Record<string, never>;
    const isEmpty = !payload || !("family" in payload) || Object.keys(payload).length === 0;

    if (isEmpty) {
      // Lazy seed: snapshot client's live data into the form
      const seed = await snapshotClientToPayload(clientId, firmId);
      await db
        .update(intakeForms)
        .set({ payload: seed, updatedAt: new Date() })
        .where(eq(intakeForms.id, form.id));

      return NextResponse.json({ payload: seed, status: form.status });
    }

    return NextResponse.json({ payload, status: form.status });
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
// On success: status → "submitted", submittedAt set, audit written.

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, firmId } = await resolveAuth();

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

    // Strict validation — the merged draft must now be complete
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
