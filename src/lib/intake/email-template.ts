/* Pure intake-email rendering. MUST NOT import resend or any server-only
 * module — this file is imported by the live-preview client component. */
import {
  DEFAULT_INTAKE_INTRO,
  DEFAULT_INTAKE_SUBJECT,
} from "@/lib/intake/defaults";

const INTAKE_FROM_ADDRESS = "noreply@foundryplanning.com";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

function renderIntroHtml(
  rawIntro: string,
  ctx: { advisorName?: string; firmName?: string; clientName?: string },
): string {
  const substituted = substituteTokens(esc(rawIntro), ctx);
  // Blank-line-separated paragraphs; single newlines → <br/>.
  return substituted
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n    ");
}

/* eslint-disable brand/no-raw-hex -- email HTML requires inline hex; email clients can't resolve CSS brand tokens */
function buildSignatureHtml(args: {
  advisorName?: string;
  firmName?: string;
  advisorEmail?: string;
}): string {
  const lines: string[] = [];
  if (args.advisorName)
    lines.push(`<p style="margin:0;font-weight:600;color:#111">${esc(args.advisorName)}</p>`);
  if (args.firmName)
    lines.push(`<p style="margin:0;color:#6b7280">${esc(args.firmName)}</p>`);
  if (args.advisorEmail)
    lines.push(
      `<p style="margin:0"><a href="mailto:${esc(args.advisorEmail)}" style="color:#1e3a5f">${esc(args.advisorEmail)}</a></p>`,
    );
  if (lines.length === 0) return "";
  return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px">
      ${lines.join("\n      ")}
    </div>`;
}

export function buildIntakeEmailHtml(args: {
  link: string;
  introBody?: string;
  advisorName?: string;
  advisorEmail?: string;
  firmName?: string;
  clientName?: string;
}): string {
  const { link, introBody, advisorName, advisorEmail, firmName, clientName } = args;
  const ctx = { advisorName, firmName, clientName };

  const brand = sanitizeDisplayName(firmName) ?? "Foundry Planning";
  const greeting = clientName ? `<p>Hello ${esc(clientName)},</p>` : `<p>Hello,</p>`;
  const introHtml = renderIntroHtml(
    sanitizeIntroBody(introBody) ?? DEFAULT_INTAKE_INTRO,
    ctx,
  );
  const signature = buildSignatureHtml({ advisorName, firmName, advisorEmail });

  return `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;max-width:560px;margin:0 auto">
  <div style="background:#1e3a5f;padding:20px 24px;border-radius:6px 6px 0 0">
    <span style="color:#fff;font-size:18px;font-weight:600">${esc(brand)}</span>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px">
    ${greeting}
    ${introHtml}
    <p style="margin:24px 0">
      <a href="${esc(link)}" style="background:#1e3a5f;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:500;display:inline-block">
        Open My Form
      </a>
    </p>
    <p style="color:#6b7280;font-size:12px">Or copy this link into your browser:<br/>${esc(link)}</p>
    ${signature}
  </div>
</div>`;
}
/* eslint-enable brand/no-raw-hex */
