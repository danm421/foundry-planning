import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import {
  requireActiveSubscriptionForFirm,
  requireClientPortalEntitlement,
  requireClientPortalForAdvisor,
  authErrorResponse,
} from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { checkPortalInviteRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { snapshotActorName } from "@/lib/audit/actor-name";
import { resolveFirmName } from "@/lib/branding/branding";
import { displayNameOf, primaryEmailOf } from "@/lib/clients/portal-account";
import { sendPortalSignInLink } from "@/lib/clients/send-portal-signin-link";

export const dynamic = "force-dynamic";

// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(id),
// which verifies the target client belongs to the caller's firm (throws ForbiddenError
// otherwise) before any mutation. The literal getOrgId/requireOrgId grep doesn't see this.

/** Support actions an advisor can run against a client's existing portal login.
 *  Granting and removing access stay on their own routes (invite / disable) —
 *  these three only help a client who already has an account get back into it. */
const ACTIONS = ["send_signin_link", "sign_out_all", "reset_two_factor"] as const;
type AccountAction = (typeof ACTIONS)[number];

/** Actions that hand a client a way IN, and therefore carry the same gates as
 *  sending an invite. Declared at the door rather than inside a branch, so the
 *  authz this route can reach is readable without tracing the dispatch: the
 *  actions NOT listed here only take away access, and must keep working even
 *  for a firm whose portal entitlement has lapsed. */
const ACCESS_GRANTING: ReadonlySet<AccountAction> = new Set(["send_signin_link"]);

function isAction(v: unknown): v is AccountAction {
  return typeof v === "string" && (ACTIONS as readonly string[]).includes(v);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { orgId: callerOrg, userId } = await requireOrgAndUser();
    const { client, firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = (await req.json().catch(() => ({}))) as { action?: unknown };
    if (!isAction(body.action)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const action = body.action;

    const clerkUserId = client.clerkUserId;
    if (!clerkUserId) {
      // Every action here operates on a login that exists. Nothing to do before
      // the client has signed up.
      return NextResponse.json(
        { error: "This client has no portal login yet" },
        { status: 409 },
      );
    }

    if (ACCESS_GRANTING.has(action)) {
      // TWO people are asked about, as on the invite route: the SENDER's firm
      // must be entitled to grant portal access, and so must the HOUSEHOLD'S
      // own advisor, because that is who sign-in resolves against.
      await requireClientPortalEntitlement(firmId);
      await requireClientPortalForAdvisor(firmId, client.advisorId);

      const limit = await checkPortalInviteRateLimit(firmId);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Rate limit exceeded", reason: limit.reason },
          { status: 429 },
        );
      }
    }

    const cc = await clerkClient();

    if (action === "send_signin_link") {
      // Three independent Clerk reads — the client, the advisor's name, the
      // firm's name. One wave, not three.
      const [user, advisorName, firmName] = await Promise.all([
        cc.users.getUser(clerkUserId),
        snapshotActorName(userId),
        resolveFirmName(firmId, null).catch(() => null),
      ]);

      const email = primaryEmailOf(user);
      if (!email) {
        return NextResponse.json(
          { error: "This portal login has no email address on file" },
          { status: 409 },
        );
      }

      const { delivered, reason } = await sendPortalSignInLink({
        clientId: id,
        clerkUserId,
        email,
        clientName: displayNameOf(user),
        advisorName,
        firmName,
        firmId,
        callerOrg,
        access,
      });

      if (!delivered) {
        return NextResponse.json(
          {
            error:
              reason === "unconfigured"
                ? "Email is not configured for this environment"
                : "The email could not be sent. Try again in a moment.",
          },
          { status: 502 },
        );
      }

      return NextResponse.json({ ok: true, email });
    }

    if (action === "sign_out_all") {
      // One page, not a loop: Clerk defaults to 10 per page, and a portal
      // client on a handful of devices is nowhere near 100 — but the default
      // would silently leave sessions signed in.
      const sessions = await cc.sessions.getSessionList({
        userId: clerkUserId,
        status: "active",
        limit: 100,
      });
      const active = sessions.data ?? [];
      await Promise.all(active.map((s) => cc.sessions.revokeSession(s.id)));

      await recordAudit({
        action: "portal.sessions.revoked",
        resourceType: "portal_binding",
        resourceId: id,
        clientId: id,
        firmId,
        actorKind: "advisor",
        metadata: crossFirmAuditMeta({ access }, callerOrg, {
          revoked: active.length,
        }),
      });

      return NextResponse.json({ ok: true, revoked: active.length });
    }

    // reset_two_factor — clears TOTP, backup codes, and any other second
    // factor so a client who lost their authenticator can sign in again.
    await cc.users.disableUserMFA(clerkUserId);

    await recordAudit({
      action: "portal.two_factor.reset",
      resourceType: "portal_binding",
      resourceId: id,
      clientId: id,
      firmId,
      actorKind: "advisor",
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/portal/account error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
