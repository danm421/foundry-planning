// Default copy + merge tokens for the client intake invitation email.
// Shared by the send path (src/lib/intake/email.ts), the settings API
// resolver, and the editor UI (placeholder text + token hint).
export const DEFAULT_INTAKE_SUBJECT = "A few details to build your financial plan";

export const DEFAULT_INTAKE_INTRO =
  "{{advisorName}} has shared a secure form to collect the financial details " +
  "we'll use to build your plan — your income, savings, accounts, and goals. " +
  "It takes about 10–15 minutes, and you can save and come back anytime. " +
  "There are no wrong answers; just fill in what you know.";

export const INTAKE_EMAIL_TOKENS = ["advisorName", "firmName", "clientName"] as const;

/* Footer copy. Not advisor-editable (unlike the subject and intro above), but
 * it lives here with the rest of the shell's user-visible strings so a copy
 * edit doesn't mean opening the renderer. Shared by all three emails on this
 * shell: the intake invitation, the risk questionnaire, and the portal
 * sign-in link — so it stays generic about what the link opens. */

/** Attribution line. `firm` is already HTML-escaped by the caller. */
export const formatSentBy = (firm: string) =>
  `Sent by ${firm} through Foundry Planning.`;

/** Used when no firm name resolved — never "Sent by Foundry Planning through
 *  Foundry Planning", which is how the branded line reads on the default. */
export const DEFAULT_INTAKE_SENT_BY_UNBRANDED = "Sent through Foundry Planning.";

/** True of all three links on this shell: each is a single-recipient token,
 *  and the sign-in link IS the credential. */
export const DEFAULT_INTAKE_LINK_NOTICE =
  "This link is personal to you — please don't forward it.";
