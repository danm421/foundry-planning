// src/lib/email/tokens.ts
//
// The palette for hand-built HTML emails. Literal hex on purpose: mail clients
// strip <style> blocks and never resolve CSS variables, so a brand token or a
// Tailwind class reaches the inbox as no colour at all. Naming the file
// `tokens.ts` is what puts it inside the brand/no-raw-hex exemption the report
// token modules already use — a palette source, not a colour that drifted.
export const EMAIL = {
  ink: "#1a1a1a",
  muted: "#6b7280",
  link: "#0f172a",
  hair: "#e5e7eb",
  danger: "#b91c1c",
} as const;

export const EMAIL_FONT =
  "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

/**
 * Chrome for CLIENT-FACING letters — the advisor's intake invitation, risk
 * questionnaire, and portal sign-in link, all rendered by
 * `@/lib/intake/email-template`.
 *
 * A separate ramp from `EMAIL` above rather than a retune of it: `EMAIL` is a
 * cool grey that the internal ops digest consumes, while a client letter is the
 * WHITE-LABEL layer and takes the design system's light/print values — warm
 * paper, slate ink, and never the Foundry verdigris accent. Same file so a
 * rebrand has one place to look.
 *
 * A firm's own logo belongs in the letter's header eventually, via
 * `resolveIntakeBrandingForClient` (@/lib/branding/resolve-for-client) — the
 * one that keeps the logo a public blob URL. NOT `resolveBranding`, whose
 * `logoDataUrl` is up to 1MB of inline base64: right for a PDF, and a
 * spam-filter liability in an email. Threading it is ordinary prop-passing,
 * not a refactor — the settings page already resolves `firmName` server-side
 * and hands it to the client preview as a prop.
 *
 * A firm's primaryColor is a separate question and deliberately NOT deferred
 * for wiring reasons: painting the button and eyebrow with it reintroduces the
 * saturated colour block this design removed, and email has no `accent-on`
 * token to keep label contrast when a firm picks a pale hue. That needs a
 * contrast rule first. Neutral never clashes with a firm's identity.
 */
export const EMAIL_LETTER = {
  /** Page behind the card. */
  canvas: "#f3f1ea",
  /** The card itself, and any text reversed out of an ink fill. */
  card: "#ffffff",
  /** Hairlines. Warm, to sit on `canvas` — hierarchy here is borders, not shadows. */
  hair: "#e8e4d6",
  /** Headings, the signature name, and the button fill. */
  ink: "#1a1d27",
  /** Body copy. */
  ink2: "#474c59",
  /** The firm eyebrow and the firm line of the signature. */
  ink3: "#5c5f69",
  /** The link fallback and the footer. Holds 4.5:1 on both `card` and `canvas`. */
  ink4: "#6a6c71",
} as const;

/** A stack, not a declaration (`EMAIL_FONT` above is a full `font-family:…`).
 *  Inter first for the readers who have it, then native; mail clients don't
 *  load webfonts, so this is the whole type story. */
export const EMAIL_LETTER_FONT =
  "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
