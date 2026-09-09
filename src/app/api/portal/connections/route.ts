import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveHouseholdNames, UNNAMED_HOUSEHOLD } from "@/lib/portal/household-names";
import { resolvePortalFirmNames, UNNAMED_FIRM } from "@/lib/portal/firm-names";
import { listActiveBindings, revokeBinding, type BindingRef } from "@/lib/portal/bindings";
import { notifyPortalDisconnected } from "@/lib/notifications/producers/portal";

export const dynamic = "force-dynamic";

/**
 * The firms holding this login, and the client's own Disconnect.
 *
 * NOT gated by `requireClientPortalAccess`, and deliberately the second
 * exception to "every /api/portal/* handler re-checks the entitlement" (the
 * first is `/api/portal/requests`). That gate resolves the ONE active household
 * and checks its firm's `client_portal` entitlement — but this endpoint spans
 * every firm the login is bound to, so a single firm switching the portal off
 * would take the client's ability to leave a DIFFERENT firm down with it. A
 * firm whose entitlement lapsed must not be able to hold on to someone's login.
 *
 * The authorization is the session plus the `clerkUserId` predicate inside
 * `bindings.ts`: every row read or written is scoped to the caller, no user id
 * is ever accepted from the request body, and the endpoint exposes nothing but
 * the caller's own connections.
 */
async function requireClientSession(): Promise<{ userId: string } | Response> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (orgId) {
    return NextResponse.json({ error: "Advisor session — portal access denied" }, { status: 403 });
  }
  return { userId };
}

export async function GET(): Promise<Response> {
  const gate = await requireClientSession();
  if (gate instanceof Response) return gate;

  const bindings = await listActiveBindings(gate.userId);
  if (bindings.length === 0) return NextResponse.json({ connections: [] });

  // Two independent lookups; neither feeds the other.
  const [householdNames, firmNames] = await Promise.all([
    resolveHouseholdNames(bindings.map((b) => b.clientId)),
    resolvePortalFirmNames(bindings.map((b) => b.firmId)),
  ]);

  return NextResponse.json({
    connections: bindings.map((b) => ({
      clientId: b.clientId,
      firmName: firmNames.get(b.firmId) ?? UNNAMED_FIRM,
      householdName: householdNames.get(b.clientId) ?? UNNAMED_HOUSEHOLD,
      since: b.acceptedAt,
    })),
  });
}

/**
 * Tell the owning advisor, AFTER the revoke has committed and never fatally.
 *
 * The name lookup lives in here with the send for one reason: at this point the
 * client's access is ALREADY gone, so anything that throws past this line would
 * answer a successful disconnect with a 500 and invite them to press it again.
 */
async function notifyOwningAdvisor(target: BindingRef): Promise<void> {
  const names = await resolveHouseholdNames([target.clientId]);
  await notifyPortalDisconnected({
    firmId: target.firmId,
    advisorId: target.advisorId,
    clientId: target.clientId,
    clientName: names.get(target.clientId) ?? null,
  });
}

/**
 * The client ends their own binding.
 *
 * Writes ONE row. The household, its plan, its documents and its audit history
 * belong to the firm and are deliberately untouched — retention rules make
 * deletion-on-request the wrong default, and the firm's record is not the
 * client's to erase.
 */
export async function DELETE(req: Request): Promise<Response> {
  const gate = await requireClientSession();
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => ({}))) as { clientId?: unknown };
  if (typeof body.clientId !== "string") {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  // Scope by the caller's OWN bindings before touching anything.
  const bindings = await listActiveBindings(gate.userId);
  const target = bindings.find((b) => b.clientId === body.clientId);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const revoked = await revokeBinding({
    clientId: target.clientId,
    clerkUserId: gate.userId,
    endedBy: "client",
    actorId: gate.userId,
  });
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A notification outage must not strand a client inside a firm they have left.
  await notifyOwningAdvisor(target).catch((err) =>
    console.error("[portal.disconnect] notify failed", err),
  );

  return NextResponse.json({ ok: true });
}
