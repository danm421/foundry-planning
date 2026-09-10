// src/lib/clients/portal-access-request-email.ts
//
// Pure rendering for the portal access-request email. MUST NOT import resend or
// any server-only module — kept separate from the transport (send-portal-access-
// request.ts) so it stays unit testable and reusable by a preview.
//
// DELIBERATELY CONTENT-FREE. This builder takes a link and nothing else. The
// requesting firm, the advisor and the household are rendered ONLY on the
// authenticated accept screen. An advisor picks who receives this mail; letting
// them also pick its words would turn a verified foundryplanning.com sender into
// a spoofing surface. Do not widen this signature.
import { escapeHtml as esc } from "@/lib/html-escape";

export const PORTAL_ACCESS_REQUEST_SUBJECT =
  "You have a pending connection request on Foundry Planning";

/* eslint-disable brand/no-raw-hex -- email HTML requires inline hex; mail clients can't resolve CSS brand tokens */
export function buildPortalAccessRequestEmailHtml(args: { link: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e0;border-radius:12px;padding:28px">
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hello,</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
      Someone has asked to connect your Foundry Planning account to a household.
      Sign in to see who is asking and to accept or decline.
    </p>
    <p style="margin:24px 0">
      <a href="${esc(args.link)}" style="display:inline-block;background:#1c6b5b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600">Review the request</a>
    </p>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b6b64">
      If you were not expecting this, you can ignore this email or decline the request after signing in.
      Nothing is shared with anyone unless you accept.
    </p>
  </div>
</body></html>`;
}
/* eslint-enable brand/no-raw-hex */
