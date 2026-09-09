// src/lib/clients/send-portal-access-request.ts
//
// Email an EXISTING Foundry account that a firm has requested a portal
// binding. Mirrors send-portal-signin-link.ts's Resend construction and
// { delivered, reason } contract, EXCEPT the From header: that file
// white-labels the sender to the requesting firm (buildIntakeFromHeader),
// which would put the firm's name right back into the one channel the
// content-free HTML can't carry it in. This email always sends from
// Foundry Planning itself — never white-labelled — because its whole point
// is that the recipient sees no firm, advisor or household name until they
// sign in.
import "server-only";
import { Resend } from "resend";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { recordAudit } from "@/lib/audit";
import {
  buildPortalAccessRequestEmailHtml,
  PORTAL_ACCESS_REQUEST_SUBJECT,
} from "@/lib/clients/portal-access-request-email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
const FROM = "Foundry Planning <noreply@foundryplanning.com>";

/**
 * Email an EXISTING Foundry account that a firm has requested a portal binding.
 *
 * REPORTS delivery rather than swallowing it: the advisor is standing at a
 * button, and a silent success on unsent mail reads as "the client has been
 * asked" when nobody has been.
 *
 * Callers verify the client belongs to the firm and rate-limit BEFORE calling.
 *
 * The audit row is written HERE, after a successful send, and nowhere else —
 * not at request-row creation. Auditing both points would write two rows per
 * request, and the earlier one would assert a request was made when no mail
 * left the building.
 *
 * NEVER throws on a delivery problem. The caller undoes its own `pending` row
 * on `{ delivered: false }`, so an escaping error would skip that undo and
 * strand a request nobody was told about — which then refuses every retry as
 * `already_live` until the TTL expires. Rendering the email body is therefore
 * inside `deliver`'s guard, not ahead of it.
 */
export async function sendPortalAccessRequest(args: {
  to: string;
  clientId: string;
  bindingId: string;
  firmId: string;
  callerOrg: string | null;
  access: "own" | "shared";
}): Promise<{ delivered: boolean; reason?: "unconfigured" | "send_failed" }> {
  const result = await deliver({ to: args.to, link: `${APP_URL}/portal/requests` });
  if (!result.delivered) {
    return result;
  }

  await recordAudit({
    action: "portal.access.requested",
    resourceType: "portal_binding",
    resourceId: args.bindingId,
    clientId: args.clientId,
    firmId: args.firmId,
    metadata: crossFirmAuditMeta({ access: args.access }, args.callerOrg, {
      email: args.to,
    }),
  });

  return { delivered: true };
}

async function deliver(args: {
  to: string;
  link: string;
}): Promise<{ delivered: boolean; reason?: "unconfigured" | "send_failed" }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      "[portal-access-request] RESEND_API_KEY is not set — the request cannot send",
    );
    return { delivered: false, reason: "unconfigured" };
  }
  try {
    // Inside the guard: a builder that throws is still an email that did not
    // send, and the caller has to hear that as a reason rather than a throw.
    const html = buildPortalAccessRequestEmailHtml({ link: args.link });
    const resend = new Resend(apiKey);
    // resend.emails.send() resolves { data: null, error } for every non-2xx
    // response rather than throwing — the `error` check is the real net.
    const { error } = await resend.emails.send({
      from: FROM,
      to: args.to,
      subject: PORTAL_ACCESS_REQUEST_SUBJECT,
      html,
    });
    if (error) {
      console.error(
        "[portal-access-request] Resend rejected the send:",
        error.message ?? error,
      );
      return { delivered: false, reason: "send_failed" };
    }
    return { delivered: true };
  } catch (err) {
    console.error(
      "[portal-access-request] the request email could not be sent:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false, reason: "send_failed" };
  }
}
