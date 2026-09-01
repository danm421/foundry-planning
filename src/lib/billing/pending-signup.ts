import { clerkClient } from "@clerk/nextjs/server";
import type { CheckoutPlan } from "@/lib/billing/checkout";

/**
 * The firm profile a self-serve buyer fills in at /welcome, held between the
 * setup step and the payment.
 *
 * It lives on the Clerk user's PRIVATE metadata, not in Postgres: there is no
 * firm yet, so a table row would be the only row in the app with nothing to
 * scope it to (see db-scoping.ts) plus orphan-row cleanup forever. `private`
 * (not `public`) keeps it off the client and out of the session token.
 *
 * Written by /welcome, read by the checkout webhook, cleared once the firm
 * exists. It never expires — it is prefill on the buyer's own record, and an
 * expiry would only be a way to lose someone who came back.
 */
export type PendingSignup = {
  firmName: string;
  advisorName: string;
  plan: CheckoutPlan;
  /** Lowercase `#rrggbb`, or null when the buyer skipped branding. */
  primaryColor: string | null;
  /** Public Vercel Blob URL under `signups/<userId>/branding/logo`. */
  logoUrl: string | null;
  updatedAt: string;
};

const KEY = "pending_signup";

const EMPTY: PendingSignup = {
  firmName: "",
  advisorName: "",
  plan: "annual",
  primaryColor: null,
  logoUrl: null,
  updatedAt: "",
};

function coerce(raw: unknown): PendingSignup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const firmName = typeof r.firmName === "string" ? r.firmName : "";
  // A stash with no firm name cannot provision anything — treat it as absent
  // rather than letting a half-written record reach the webhook.
  if (!firmName.trim()) return null;
  return {
    firmName,
    advisorName: typeof r.advisorName === "string" ? r.advisorName : "",
    plan: r.plan === "monthly" ? "monthly" : "annual",
    primaryColor: typeof r.primaryColor === "string" ? r.primaryColor : null,
    logoUrl: typeof r.logoUrl === "string" ? r.logoUrl : null,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

async function readRawMetadata(
  userId: string,
): Promise<Record<string, unknown>> {
  const cc = await clerkClient();
  const user = await cc.users.getUser(userId);
  return (user.privateMetadata ?? {}) as Record<string, unknown>;
}

/** Fail-soft: a Clerk read failure yields an empty form, never a crashed page. */
export async function readPendingSignup(
  userId: string,
): Promise<PendingSignup | null> {
  try {
    return coerce((await readRawMetadata(userId))[KEY]);
  } catch (err) {
    console.error("[pending-signup] read failed:", err);
    return null;
  }
}

/**
 * Merge `patch` onto whatever is already stashed and persist it. Merging is
 * load-bearing: the branding panel saves a logo while the name fields are still
 * being typed, and a replacing write would silently drop the firm name.
 */
export async function writePendingSignup(
  userId: string,
  patch: Partial<PendingSignup>,
): Promise<PendingSignup> {
  const meta = await readRawMetadata(userId);
  const current = coerce(meta[KEY]) ?? EMPTY;
  const next: PendingSignup = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const cc = await clerkClient();
  await cc.users.updateUserMetadata(userId, {
    privateMetadata: { ...meta, [KEY]: next },
  });
  return next;
}

/**
 * Called once the firm exists. Best-effort at every call site.
 *
 * `updateUserMetadata` DEEP-MERGES (see the Clerk backend SDK docs on the
 * method), so sending an object with the key merely omitted removes nothing —
 * the stash would survive on the user record forever and a second checkout by
 * the same buyer would name the new firm from the stale one. A key is deleted
 * only by setting it to `null`.
 *
 * The tombstone also makes this a single write with no read-modify-write: the
 * merge leaves every other private-metadata key untouched by construction.
 */
export async function clearPendingSignup(userId: string): Promise<void> {
  const cc = await clerkClient();
  await cc.users.updateUserMetadata(userId, {
    privateMetadata: { [KEY]: null },
  });
}
