// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(clientId) / requireOrgId; the literal getOrgId/requireOrgId grep doesn't see this.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, intakeForms } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { clerkInviteErrorResponse } from "@/lib/clients/portal-invite-errors";
import { checkPortalInviteRateLimit } from "@/lib/rate-limit";
import { sendPortalInvite } from "@/lib/clients/send-portal-invite";
import { sendIntakeFormEmail } from "@/lib/intake/email";
import { newIntakeToken, defaultExpiry } from "@/lib/intake/tokens";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mode?: unknown;
      clientId?: unknown;
      recipientEmail?: unknown;
      recipientName?: unknown;
    };

    // ── Validate body ──────────────────────────────────────────────────────
    const { mode, clientId, recipientEmail, recipientName } = body;

    if (mode !== "blank" && mode !== "prefilled") {
      return NextResponse.json(
        { error: "mode must be 'blank' or 'prefilled'" },
        { status: 400 },
      );
    }

    if (
      typeof recipientEmail !== "string" ||
      !EMAIL_RE.test(recipientEmail)
    ) {
      return NextResponse.json(
        { error: "Valid recipientEmail required" },
        { status: 400 },
      );
    }

    if (mode === "prefilled" && !clientId) {
      return NextResponse.json(
        { error: "clientId is required for prefilled mode" },
        { status: 400 },
      );
    }

    const recipientNameStr =
      typeof recipientName === "string" ? recipientName : undefined;
    const clientIdStr =
      typeof clientId === "string" ? clientId : undefined;

    // ── Auth ───────────────────────────────────────────────────────────────
    const { orgId, userId } = await requireOrgAndUser();

    let firmId: string;
    const callerOrg: string = orgId;
    let access: "own" | "shared" = "own";

    if (clientIdStr) {
      const acc = await requireClientEditAccess(clientIdStr);
      firmId = acc.firmId;
      access = acc.access;
    } else {
      firmId = orgId;
    }

    await requireActiveSubscriptionForFirm(firmId);

    // ── Rate-limit (prefilled only) ────────────────────────────────────────
    if (mode === "prefilled") {
      const limit = await checkPortalInviteRateLimit(firmId);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Rate limit exceeded", reason: limit.reason },
          { status: 429 },
        );
      }
    }

    // ── Insert form ────────────────────────────────────────────────────────
    const now = new Date();
    const token = newIntakeToken();
    const expiresAt = defaultExpiry(now);

    const [form] = await db
      .insert(intakeForms)
      .values({
        firmId,
        clientId: clientIdStr ?? null,
        mode,
        token,
        recipientEmail,
        recipientName: recipientNameStr ?? null,
        createdByUserId: userId,
        sentAt: now,
        expiresAt,
      })
      .returning({ id: intakeForms.id });

    const formId = form.id;

    // ── Send ───────────────────────────────────────────────────────────────
    let invitationId: string | undefined;

    if (mode === "blank") {
      const link = `${APP_URL}/intake/${token}`;
      await sendIntakeFormEmail({
        to: recipientEmail,
        link,
        householdName: recipientNameStr,
      });
    } else {
      // prefilled — send portal invite unless client is already bound
      const [clientRow] = await db
        .select({ clerkUserId: clients.clerkUserId })
        .from(clients)
        .where(eq(clients.id, clientIdStr!));

      if (!clientRow?.clerkUserId) {
        // Not yet bound — send invite (Clerk dup errors are non-fatal here:
        // the form already exists and is the primary artifact; the client
        // can reach it once signed in through other means).
        try {
          const result = await sendPortalInvite({
            clientId: clientIdStr!,
            email: recipientEmail,
            firmId,
            callerOrg,
            access,
          });
          invitationId = result.invitationId;
        } catch (inviteErr) {
          // Map Clerk dup-email errors to a 200-with-warning: the form was
          // created successfully and is the primary artifact. The advisor
          // should know the invite wasn't re-sent (already invited / already
          // has an account), but we don't roll back the form row.
          const clerkRes = clerkInviteErrorResponse(inviteErr);
          if (clerkRes) {
            await recordAudit({
              action: "intake.form.sent",
              resourceType: "intake_form",
              resourceId: formId,
              clientId: clientIdStr ?? null,
              firmId,
            });
            return NextResponse.json(
              {
                ok: true,
                formId,
                token,
                warning: clerkRes.error,
              },
              { status: 200 },
            );
          }
          // Non-Clerk error: re-throw so the outer catch handles it.
          throw inviteErr;
        }
      }
      // If clerkUserId is set the client is already bound — skip the invite.
    }

    // ── Audit ──────────────────────────────────────────────────────────────
    await recordAudit({
      action: "intake.form.sent",
      resourceType: "intake_form",
      resourceId: formId,
      clientId: clientIdStr ?? null,
      firmId,
    });

    return NextResponse.json({
      ok: true,
      formId,
      token,
      ...(invitationId ? { invitationId } : {}),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    const clerkRes = clerkInviteErrorResponse(err);
    if (clerkRes) {
      return NextResponse.json({ error: clerkRes.error }, { status: clerkRes.status });
    }
    console.error("POST /api/data-collection error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
