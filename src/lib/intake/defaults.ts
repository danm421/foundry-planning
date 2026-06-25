// Default copy + merge tokens for the client intake invitation email.
// Shared by the send path (src/lib/intake/email.ts), the settings API
// resolver, and the editor UI (placeholder text + token hint).
export const DEFAULT_INTAKE_SUBJECT = "Your financial planning form is ready.";

export const DEFAULT_INTAKE_INTRO =
  "{{advisorName}} has shared a secure form to collect the financial details " +
  "we'll use to build your plan — your income, savings, accounts, and goals. " +
  "It takes about 10–15 minutes, and you can save and come back anytime. " +
  "There are no wrong answers; just fill in what you know.";

export const INTAKE_EMAIL_TOKENS = ["advisorName", "firmName", "clientName"] as const;
