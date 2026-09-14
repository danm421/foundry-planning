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
