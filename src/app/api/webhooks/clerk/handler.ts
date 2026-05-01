import { NextResponse } from "next/server";
import { seedCmaForFirm } from "@/lib/cma-seed-runner";
import { recordAudit } from "@/lib/audit";
import { dispatchClerkMembership } from "./membership-handlers";

export type ClerkEvent = {
  type: string;
  data: { id?: string } & Record<string, unknown>;
};

/**
 * Dispatch a verified Clerk webhook event. Pure — takes the event payload
 * and produces a Response. Signature verification is handled upstream in
 * the route; this function assumes the event is trustworthy.
 *
 * organization.created → seed CMAs for the new firm. Other event types
 * are accepted (200) but ignored, so adding new Clerk subscriptions in
 * the dashboard never breaks this endpoint.
 */
export async function handleClerkEvent(evt: ClerkEvent): Promise<Response> {
  if (evt.type !== "organization.created") {
    const dispatched = await dispatchClerkMembership(evt);
    if (dispatched) return dispatched;
    return NextResponse.json({ ok: true, ignored: evt.type }, { status: 200 });
  }

  const firmId = evt.data?.id;
  if (!firmId) {
    console.error("[webhook.clerk] organization.created missing data.id");
    return NextResponse.json(
      { error: "organization.created payload missing data.id" },
      { status: 400 }
    );
  }

  try {
    const result = await seedCmaForFirm(firmId);
    await recordAudit({
      action: "cma.seed",
      resourceType: "cma",
      resourceId: firmId,
      firmId,
      actorId: "clerk:webhook",
      metadata: { ...result, trigger: "clerk.organization.created" },
    });
    return NextResponse.json(
      { seeded: true, firmId, ...result },
      { status: 200 }
    );
  } catch (err) {
    // Returning 500 signals Clerk to retry. Helper is idempotent so
    // retries are safe.
    console.error(
      `[webhook.clerk] seed failed for firm ${firmId}:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "seed failed" },
      { status: 500 }
    );
  }
}
