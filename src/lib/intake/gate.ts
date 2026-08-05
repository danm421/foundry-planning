import { createHmac, createHash, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Identity gate for the PUBLIC intake flow (`/intake/<token>`).
 *
 * The token alone used to be the whole authority: anyone holding the link could
 * read back everything the client had typed (DOBs, balances, income) for the
 * full 30-day link life. A forwarded email, a shared computer's history, or a
 * pasted link was enough. This module adds a second factor the link-holder does
 * not automatically possess — the recipient's own surname + email — and mints a
 * short-lived signed session once they prove it.
 *
 * The token still scopes WHICH form you may attempt; this decides whether you
 * get to see or write its contents.
 *
 * Not used by the authenticated portal intake (`/portal/intake`), which already
 * sits behind a Clerk session.
 */

// 12h: long enough to finish in one sitting or come back after lunch, short
// enough that a borrowed laptop doesn't stay unlocked for the link's 30 days.
export const GATE_SESSION_MS = 12 * 60 * 60 * 1000;

// ─── Key material ─────────────────────────────────────────────────────────────

/**
 * Prefer a dedicated INTAKE_GATE_SECRET so the gate key can be rotated on its
 * own. When unset we derive one from CLERK_SECRET_KEY via HKDF with a distinct
 * `info` label — domain separation makes the derived key cryptographically
 * independent of the Clerk key, and CLERK_SECRET_KEY is server-only and already
 * required for the app to boot.
 *
 * Deriving rather than requiring new config is deliberate: a missing env var
 * would lock every client out of their own form, which is a far worse failure
 * than the (already sound) key reuse this avoids.
 *
 * Resolved per call rather than memoized at module load so env changes in tests
 * and on redeploy are picked up.
 */
function gateKey(): Buffer {
  const dedicated = process.env.INTAKE_GATE_SECRET;
  if (dedicated) return Buffer.from(dedicated, "utf8");

  const clerk = process.env.CLERK_SECRET_KEY;
  if (!clerk) {
    throw new Error(
      "[intake gate] neither INTAKE_GATE_SECRET nor CLERK_SECRET_KEY is set — " +
        "cannot sign intake gate sessions.",
    );
  }
  return Buffer.from(
    hkdfSync("sha256", clerk, "foundry-intake-gate", "foundry-intake-gate-v1", 32),
  );
}

/** Constant-time string compare via equal-length digests. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

// ─── Identity matching ────────────────────────────────────────────────────────

/**
 * Fold a human name to a comparable form: strip diacritics, lowercase, and
 * reduce every run of non-alphanumerics to a single space.
 * "Renée O'Brien-Smith" → "renee o brien smith"
 *
 * Deliberately not shared with the private `normalize` in lib/crm/import.ts:
 * that one keeps punctuation (it feeds fuzzy household dedup scoring), while
 * surname matching has to fold it. Merging them would change CRM match scores.
 */
function normalizeName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks left by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Space-free form, so "O'Brien Smith" and "obriensmith" compare equal. */
const collapse = (s: string): string => s.replace(/ /g, "");

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Every surname the client might reasonably type, given the stored full name.
 * For "Mary Anne Van Der Berg" that's the whole name plus each trailing run —
 * "van der berg", "der berg", "berg" — so multi-word surnames work whether the
 * client types all of it or just the last word.
 *
 * Returns [] when the stored name has no usable surname (absent, blank, or a
 * single token like "Cher"), which callers treat as "verify on email alone".
 */
function surnameCandidates(recipientName: string | null | undefined): string[] {
  const tokens = normalizeName(recipientName ?? "").split(" ").filter(Boolean);
  if (tokens.length < 2) return [];
  // i = 0 → the full name; i >= 1 → each trailing suffix.
  return tokens.map((_, i) => collapse(tokens.slice(i).join(" ")));
}

export interface IntakeIdentityForm {
  recipientName: string | null;
  recipientEmail: string;
}

export interface IntakeIdentityInput {
  lastName: string;
  email: string;
}

/**
 * True when the supplied surname + email identify this form's recipient.
 *
 * Email must always match. The surname check is skipped only when the advisor
 * stored no usable surname — never let a data gap make a client's own form
 * unopenable.
 */
export function matchesIntakeIdentity(
  form: IntakeIdentityForm,
  input: IntakeIdentityInput,
): boolean {
  const email = normalizeEmail(input.email ?? "");
  if (!email) return false;
  if (!safeEqual(email, normalizeEmail(form.recipientEmail ?? ""))) return false;

  const candidates = surnameCandidates(form.recipientName);
  if (candidates.length === 0) return true; // email-only fallback

  const supplied = collapse(normalizeName(input.lastName ?? ""));
  if (!supplied) return false;

  return candidates.some((candidate) => safeEqual(supplied, candidate));
}

// ─── Signed session ───────────────────────────────────────────────────────────

/**
 * Per-form cookie name, so unlocking one form never unlocks another and a
 * household with two invites keeps two independent sessions.
 */
export function gateCookieName(formId: string): string {
  const suffix = createHash("sha256").update(formId).digest("hex").slice(0, 16);
  return `fp_ig_${suffix}`;
}

/** `<expiryMs>.<signature>` — the signature covers the expiry and the form id. */
export function signGateSession(formId: string, now: Date = new Date()): string {
  const exp = now.getTime() + GATE_SESSION_MS;
  return `${exp}.${sign(formId, exp)}`;
}

function sign(formId: string, exp: number): string {
  return createHmac("sha256", gateKey())
    .update(`v1|${formId}|${exp}`)
    .digest("base64url");
}

/** True only for an unexpired signature minted for exactly this form. */
export function verifyGateSession(
  value: string | null | undefined,
  formId: string,
  now: Date = new Date(),
): boolean {
  if (!value) return false;

  const parts = value.split(".");
  if (parts.length !== 2) return false;

  const [expRaw, sig] = parts;
  if (!/^\d+$/.test(expRaw)) return false;

  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || now.getTime() >= exp) return false;

  return safeEqual(sig, sign(formId, exp));
}
