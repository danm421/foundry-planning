import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms, subscriptions, tosAcceptances } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";
import type { ClerkEvent } from "./handler";

type MembershipEventData = {
  organization?: { id?: string };
  public_user_data?: { user_id?: string };
  previous_attributes?: { role?: string };
  role?: string;
};

type UserCreatedData = {
  id?: string;
  legal_consent?: { tos_accepted_at?: string; tos_version?: string };
};

/**
 * Adjust the seat quantity on the firm's Stripe subscription by `delta`.
 * No-op for founder orgs (no subscription mapped) and for firms without a
 * live subscription. Reads current seat quantity from Stripe, applies
 * delta, writes back. The webhook subscription.updated will fire the
 * DB+Clerk metadata sync downstream.
 */
async function adjustSeatQuantity(
  firmId: string,
  delta: 1 | -1,
): Promise<void> {
  const firmRows = await db.select().from(firms).where(eq(firms.firmId, firmId));
  const firm = firmRows[0];
  if (!firm || firm.isFounder) return;

  const subRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId));
  const sub = subRows.find((s) =>
    ["trialing", "active", "past_due", "unpaid"].includes(s.status),
  );
  if (!sub) return;

  const stripe = getStripe();
  const liveSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
    expand: ["items.data.price"],
  });
  const seat = liveSub.items.data.find(
    (it) =>
      ((it.metadata as Record<string, string | undefined>).kind ?? "seat") !==
      "addon",
  );
  if (!seat) return;
  const newQuantity = Math.max(0, (seat.quantity ?? 1) + delta);
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items: [{ id: seat.id, quantity: newQuantity }],
    proration_behavior: "create_prorations",
  });
}

export async function dispatchClerkMembership(
  evt: ClerkEvent,
): Promise<Response | null> {
  const t = evt.type;

  if (t === "organizationMembership.created") {
    const d = evt.data as MembershipEventData;
    const firmId = d.organization?.id;
    const userId = d.public_user_data?.user_id;
    if (!firmId || !userId) {
      return NextResponse.json({ error: "missing IDs" }, { status: 400 });
    }
    await adjustSeatQuantity(firmId, 1);
    await recordAudit({
      action: "member.invited",
      resourceType: "membership",
      resourceId: `${firmId}:${userId}`,
      firmId,
      actorId: "clerk:webhook",
      metadata: { user_id: userId },
    });
    return NextResponse.json({ ok: true, handled: t }, { status: 200 });
  }

  if (t === "organizationMembership.deleted") {
    const d = evt.data as MembershipEventData;
    const firmId = d.organization?.id;
    const userId = d.public_user_data?.user_id;
    if (!firmId || !userId) {
      return NextResponse.json({ error: "missing IDs" }, { status: 400 });
    }
    await adjustSeatQuantity(firmId, -1);
    await recordAudit({
      action: "member.removed",
      resourceType: "membership",
      resourceId: `${firmId}:${userId}`,
      firmId,
      actorId: "clerk:webhook",
      metadata: { user_id: userId },
    });
    return NextResponse.json({ ok: true, handled: t }, { status: 200 });
  }

  if (t === "organizationMembership.updated") {
    const d = evt.data as MembershipEventData;
    const firmId = d.organization?.id;
    const userId = d.public_user_data?.user_id;
    if (!firmId || !userId) {
      return NextResponse.json({ error: "missing IDs" }, { status: 400 });
    }
    const prevRole = d.previous_attributes?.role;
    const newRole = d.role;
    if (prevRole && newRole && prevRole !== newRole) {
      await recordAudit({
        action: "member.role_changed",
        resourceType: "membership",
        resourceId: `${firmId}:${userId}`,
        firmId,
        actorId: "clerk:webhook",
        metadata: { from: prevRole, to: newRole, user_id: userId },
      });
    }
    return NextResponse.json({ ok: true, handled: t }, { status: 200 });
  }

  if (t === "user.created") {
    const d = evt.data as UserCreatedData;
    const userIdNew = d.id;
    const consent = d.legal_consent;
    if (userIdNew && consent?.tos_accepted_at) {
      await db
        .insert(tosAcceptances)
        .values({
          userId: userIdNew,
          firmId: null,
          tosVersion: consent.tos_version ?? "v1",
          acceptanceSource: "clerk_signup",
        })
        .onConflictDoNothing()
        .returning({ id: tosAcceptances.id });
    }
    return NextResponse.json({ ok: true, handled: t }, { status: 200 });
  }

  return null;
}
