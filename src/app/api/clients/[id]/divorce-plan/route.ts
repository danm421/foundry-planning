// Draft workbench read/create/update routes. Thin wrappers over the Task 5
// service (src/lib/divorce/divorce-plans.ts) — all business logic (married
// check, spouse-contact check, race-safe create, settings patch) lives there.
//
// Auth preamble copied from src/app/api/clients/[id]/family-members/route.ts:
// GET gates with verifyClientAccess() -> 404; mutations use
// requireOrgAndUser() + requireClientEditAccess() + requireActiveSubscriptionForFirm().
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { formatZodIssues } from "@/lib/schemas/common";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import {
  getOrCreateDraft,
  updateDraftSettings,
  loadWorkbench,
  DivorcePlanError,
} from "@/lib/divorce/divorce-plans";
import { divorceDraftSettingsSchema } from "@/lib/divorce/schemas";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const payload = await loadWorkbench({ clientId: id, firmId: access.firmId });
    return NextResponse.json(payload);
  } catch (err) {
    // no_draft is the expected steady-state before a draft exists (or after
    // it's abandoned) — surface as 404, not the generic 422 the other routes
    // use for DivorcePlanError, since there's nothing to act on yet.
    if (err instanceof DivorcePlanError && err.code === "no_draft") {
      return NextResponse.json({ error: "no_draft" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/divorce-plan error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await requireOrgAndUser();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // getOrCreateDraft can throw a plain Error("Client not found") for a
    // deleted/missing client — the requireClientEditAccess() call above
    // already 403/404s cross-firm and non-existent-client callers, so this
    // only fires for a client deleted between that check and this call; 500
    // is acceptable there.
    await getOrCreateDraft({ clientId: id, firmId, userId });
    const payload = await loadWorkbench({ clientId: id, firmId });
    return NextResponse.json(payload);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    if (err instanceof DivorcePlanError) {
      return NextResponse.json({ error: err.code, code: err.code }, { status: 422 });
    }
    console.error("POST /api/clients/[id]/divorce-plan error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireOrgAndUser();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = await request.json();
    const patch = divorceDraftSettingsSchema.parse(body);

    await updateDraftSettings({ clientId: id, firmId, patch });
    const payload = await loadWorkbench({ clientId: id, firmId });
    return NextResponse.json(payload);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(err) },
        { status: 422 }
      );
    }
    if (err instanceof DivorcePlanError) {
      return NextResponse.json({ error: err.code, code: err.code }, { status: 422 });
    }
    console.error("PATCH /api/clients/[id]/divorce-plan error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
