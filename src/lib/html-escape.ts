// src/lib/html-escape.ts
//
// The one HTML escaper. React escapes for us everywhere it renders, so this is
// for the places that build HTML strings by hand — the three mailers
// (notifications/digest, feedback/email, intake/email-template), whose output
// goes to a mail client rather than through the React renderer.
//
// It lived as three near-copies before, and they had drifted: two escaped only
// `& < >`, which is fine in a text node but NOT in the attribute contexts those
// templates actually use (`href="mailto:${...}"` — an unescaped `"` closes the
// attribute and what follows is parsed as more attributes, i.e. an event
// handler). One shared copy is what keeps that from drifting apart again.
//
// Deliberately dependency-free: intake/email-template.ts is imported by a
// client component for the live preview, so nothing here may pull in a
// server-only module.

/**
 * Escapes text for interpolation into HTML, including double-quoted and
 * single-quoted attribute values.
 *
 * `&` is replaced first — otherwise the `&` in the entities the later
 * replacements produce would itself be escaped, yielding `&amp;lt;`.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
