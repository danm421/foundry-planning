/* Pure intake-email rendering. MUST NOT import resend or any server-only
 * module — this file is imported by the live-preview client component.
 *
 * buildIntakeEmailHtml returns a COMPLETE HTML document, not a fragment: the
 * head is where a mail client reads the colour-scheme hints, and where the
 * advisor preview gets its charset without wrapping our output in markup of
 * its own. Three emails render through it — the intake invitation, the risk
 * questionnaire, and the portal sign-in link. */
import {
  DEFAULT_INTAKE_INTRO,
  DEFAULT_INTAKE_LINK_NOTICE,
  DEFAULT_INTAKE_SENT_BY_UNBRANDED,
  DEFAULT_INTAKE_SUBJECT,
  formatSentBy,
} from "@/lib/intake/defaults";

const INTAKE_FROM_ADDRESS = "noreply@foundryplanning.com";

// Quote escaping is load-bearing here, not tidiness: the signature below
// interpolates into a double-quoted ATTRIBUTE (`href="mailto:${esc(...)}"`),
// where an unescaped `"` closes the attribute and everything after it parses
// as further attributes — i.e. an event handler. That matters twice over:
// this same HTML is rendered through `dangerouslySetInnerHTML` in the
// advisor-facing settings preview (components/intake/admin/
// email-settings-editor.tsx), so the payload would execute in an advisor's
// browser, not only in the recipient's mail client.
import { escapeHtml as esc } from "@/lib/html-escape";

/** Strip control chars (incl. CR/LF — header-injection guard) and collapse
 * whitespace. Returns undefined for empty/blank input so callers fall back. */
function sanitizeDisplayName(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

/** Strip C0 control chars + DEL but PRESERVE newlines/tabs, so a
 * multi-paragraph intro keeps its paragraph breaks. Normalizes CRLF/CR to
 * LF. Returns undefined for blank input so callers fall back to the default. */
function sanitizeIntroBody(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return cleaned || undefined;
}

/**
 * Build the `From` header. Display name precedence:
 *   INTAKE_EMAIL_FROM env (operator override, full From) > fromName > firmName > "Foundry".
 * Address always stays on the verified domain.
 */
export function buildIntakeFromHeader(fromName?: string, firmName?: string): string {
  // Server-only operator override (no NEXT_PUBLIC_ prefix): resolves to
  // undefined in the client live-preview, so the preview shows the computed
  // display name while a configured send uses the override. Intentional — the
  // var is normally unset, so preview and send agree in practice.
  const explicit = process.env.INTAKE_EMAIL_FROM;
  if (explicit) return explicit;

  const display =
    sanitizeDisplayName(fromName) ?? sanitizeDisplayName(firmName) ?? "Foundry";
  const quoted = `"${display.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  return `${quoted} <${INTAKE_FROM_ADDRESS}>`;
}

export function resolveSubject(subject?: string): string {
  return sanitizeDisplayName(subject) ?? DEFAULT_INTAKE_SUBJECT;
}

function substituteTokens(
  escapedText: string,
  ctx: { advisorName?: string; firmName?: string; clientName?: string },
): string {
  // escapedText is already HTML-escaped; tokens (no special chars) survive.
  // Substitute ESCAPED values so injected names/firms can't break out.
  return escapedText
    .replaceAll("{{advisorName}}", esc(ctx.advisorName ?? ""))
    .replaceAll("{{firmName}}", esc(ctx.firmName ?? ""))
    .replaceAll("{{clientName}}", esc(ctx.clientName ?? ""));
}

/* The palette and type stack live in the shared email token module — the one
 * file that carries the raw-hex exemption for mail, and the one place a rebrand
 * of email chrome has to look. `EMAIL_LETTER` documents why a client letter
 * takes the white-label neutrals rather than the Foundry accent.
 *
 * Aliased short because these values appear ~20 times across one dense
 * template literal below, where `EMAIL_LETTER.ink3` would bury the markup. */
import { EMAIL_LETTER as C, EMAIL_LETTER_FONT as FONT } from "@/lib/email/tokens";

/** One body-paragraph style, inked per role: the greeting sits a shade darker
 *  than the copy beneath it. */
const bodyP = (color: string) =>
  `margin:0 0 14px;font-size:15px;line-height:1.65;color:${color}`;

function renderIntroHtml(
  rawIntro: string,
  ctx: { advisorName?: string; firmName?: string; clientName?: string },
): string {
  const substituted = substituteTokens(esc(rawIntro), ctx);
  // Blank-line-separated paragraphs; single newlines → <br/>. Each paragraph
  // carries its own inline style because a bare <p>'s default margin and size
  // differ per mail client — nothing here may inherit.
  return substituted
    .split(/\n\s*\n/)
    .map((p) => `<p style="${bodyP(C.ink2)}">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

function buildSignatureHtml(args: {
  advisorName?: string;
  firmName?: string;
  advisorEmail?: string;
}): string {
  const lines: string[] = [];
  if (args.advisorName)
    lines.push(
      `<p style="margin:0;font-size:14px;font-weight:600;color:${C.ink}">${esc(args.advisorName)}</p>`,
    );
  if (args.firmName)
    lines.push(
      `<p style="margin:3px 0 0;font-size:13px;line-height:1.5;color:${C.ink3}">${esc(args.firmName)}</p>`,
    );
  if (args.advisorEmail)
    lines.push(
      `<p style="margin:3px 0 0;font-size:13px;line-height:1.5"><a href="mailto:${esc(args.advisorEmail)}" style="color:${C.ink2};text-decoration:none">${esc(args.advisorEmail)}</a></p>`,
    );
  if (lines.length === 0) return "";
  return `<div style="margin-top:32px;padding-top:20px;border-top:1px solid ${C.hair}">${lines.join("\n")}</div>`;
}

export function buildIntakeEmailHtml(args: {
  link: string;
  introBody?: string;
  advisorName?: string;
  advisorEmail?: string;
  firmName?: string;
  clientName?: string;
  /** Button label. Defaults to the intake wording; other senders on this same
   *  shell (risk questionnaire, portal sign-in link) override it so the button
   *  names what the link actually opens. */
  ctaLabel?: string;
}): string {
  const { link, introBody, advisorName, advisorEmail, firmName, clientName } = args;
  const ctx = { advisorName, firmName, clientName };

  const firm = sanitizeDisplayName(firmName);
  const brand = firm ?? "Foundry Planning";
  const cta = sanitizeDisplayName(args.ctaLabel) ?? "Open My Form";
  const greeting = clientName ? `Hello ${esc(clientName)},` : "Hello,";
  const introHtml = renderIntroHtml(
    sanitizeIntroBody(introBody) ?? DEFAULT_INTAKE_INTRO,
    ctx,
  );
  const signature = buildSignatureHtml({ advisorName, firmName, advisorEmail });
  // Says who actually sent this. MITIGATION, not a fix: Outlook's "You don't
  // often get email from…" banner is unfamiliar-SENDER reputation — no body
  // copy moves it, only per-firm verified sending domains in Resend will. What
  // the line does earn is the reader's trust once the banner is already there,
  // since the From address is on Foundry's domain under the firm's name.
  const sentBy = firm
    ? formatSentBy(esc(firm))
    : DEFAULT_INTAKE_SENT_BY_UNBRANDED;

  // A full document, not a fragment: the colour-scheme hints below only work
  // as head-level <meta> (a :root rule in body content is stripped or ignored),
  // and Resend sends a whole document happily — portal-access-request-email.ts
  // already does. Table shell with bgcolor attributes because Outlook's Word
  // renderer drops max-width and CSS background on a plain <div>, which is how
  // a centred card ends up full-bleed. Everything load-bearing is inline; the
  // <style> block only narrows phone padding, and the email is still correct
  // when a client strips it.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<style>
  @media (max-width:480px) {
    .fp-x { padding-left:22px !important; padding-right:22px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="width:100%;border-collapse:collapse;background:${C.canvas}">
  <tr>
    <td align="center" style="padding:32px 16px;font-family:${FONT}">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width:100%;max-width:600px;border-collapse:separate;background:${C.card};border:1px solid ${C.hair};border-radius:10px">
        <tr>
          <td class="fp-x" style="padding:20px 32px;border-bottom:1px solid ${C.hair}">
            <span style="font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.ink3}">${esc(brand)}</span>
          </td>
        </tr>
        <tr>
          <td class="fp-x" align="left" style="padding:32px;font-family:${FONT}">
            <p style="${bodyP(C.ink)}">${greeting}</p>
            ${introHtml}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 24px;border-collapse:separate">
              <tr>
                <td bgcolor="${C.ink}" style="background:${C.ink};border-radius:6px">
                  <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${C.card};text-decoration:none">${esc(cta)}</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:12px;line-height:1.6;color:${C.ink4}">If the button doesn't work, paste this link into your browser:<br/><span style="color:${C.ink2};word-break:break-all">${esc(link)}</span></p>
            ${signature}
          </td>
        </tr>
      </table>
      <p style="margin:18px 0 0;max-width:600px;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.ink4};text-align:center">${sentBy} ${DEFAULT_INTAKE_LINK_NOTICE}</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}
