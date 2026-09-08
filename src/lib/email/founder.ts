// src/lib/email/founder.ts
//
// The founder's sending identity, shared by the handful of plain-text notes
// that come from Dan personally rather than from the product: the signup
// welcome (lib/onboarding/welcome-email.ts) and the "why did you cancel?"
// note (lib/billing/trial-feedback.ts).
//
// One address, one place to change it. These are deliberately NOT the
// billing/support senders — those speak for the system and live behind their
// own BILLING_EMAIL_FROM / SUPPORT_EMAIL_FROM vars.

/** Envelope sender. Must stay on the Resend-verified foundryplanning.com domain. */
export const FOUNDER_FROM = "Dan Mueller <dan@foundryplanning.com>";

/** Where replies land. The whole point of these notes is that they get answered. */
export const FOUNDER_REPLY_TO = "dan@foundryplanning.com";
