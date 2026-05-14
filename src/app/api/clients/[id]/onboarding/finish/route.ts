import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { deriveStepStatuses } from "@/lib/onboarding/step-status";
import type { OnboardingState } from "@/lib/onboarding/types";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    await requireActiveSubscription();
    const { id } = await params;

    const [row] = await db
      .select({ id: clients.id, state: clients.onboardingState })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { effectiveTree } = await loadEffectiveTree(id, firmId, "base", {});
    const statuses = deriveStepStatuses(
      effectiveTree,
      (row.state as OnboardingState | null) ?? {},
    );

    const blockers = statuses
      .filter((s) => s.slug !== "review" && s.kind !== "complete" && s.kind !== "skipped")
      .map((s) => s.slug);

    if (blockers.length > 0) {
      return NextResponse.json({ error: "Onboarding incomplete", blockers }, { status: 409 });
    }

    const now = new Date();
    await db
      .update(clients)
      .set({ onboardingCompletedAt: now, updatedAt: now })
      .where(eq(clients.id, id));
    await recordAudit({
      firmId,
      action: "client.onboarding.finish",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      metadata: {},
    });

    return NextResponse.json({ ok: true, completedAt: now.toISOString() });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/onboarding/finish error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
