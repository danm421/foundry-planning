"use server";

import { auth } from "@clerk/nextjs/server";
import {
  buildCheckoutSessionParams,
  PLAN_PRICE_KEY,
  type CheckoutPlan,
} from "@/lib/billing/checkout";
import {
  readPendingSignup,
  writePendingSignup,
} from "@/lib/billing/pending-signup";
import { putSignupBrandingAsset } from "@/lib/branding/blob";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkCheckoutSessionRateLimit } from "@/lib/rate-limit";
import { validateLogo, validatePrimaryColor } from "@/lib/branding/validation";

type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

/**
 * Everything here runs for a signed-in buyer who deliberately has NO org — the
 * Clerk org is not created until the payment lands, because proxy.ts blocks an
 * org with no subscription metadata outright. An org-having caller has finished
 * this flow already and is turned away.
 */
async function requireOrglessBuyer(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const { userId, orgId } = await auth();
  if (!userId) return { ok: false, error: "You need to be signed in." };
  if (orgId) return { ok: false, error: "You already have a workspace." };
  return { ok: true, userId };
}

export async function saveSignupProfile(input: {
  firmName: string;
  advisorName: string;
  primaryColor: string | null;
  // The plan the buyer picked on the storefront, threaded here through
  // /sign-up?plan=... and /welcome?plan=.... It has to be stashed alongside
  // the firm details: startSignupCheckout prices off PLAN_PRICE_KEY[stash.plan],
  // and the /welcome page itself prefers a saved stash over the URL for a
  // returning buyer. If nothing writes it here, both read a stash that
  // defaults to "annual" (see coerce() in pending-signup.ts) regardless of
  // what the buyer actually chose.
  plan: CheckoutPlan;
}): Promise<ActionResult> {
  const who = await requireOrglessBuyer();
  if (!who.ok) return who;

  const firmName = input.firmName.trim();
  if (!firmName) return { ok: false, error: "Enter your firm name." };

  const colour = validatePrimaryColor(input.primaryColor);
  if (!colour.ok) return colour;

  await writePendingSignup(who.userId, {
    firmName,
    advisorName: input.advisorName.trim(),
    primaryColor: colour.value,
    plan: input.plan,
  });
  return { ok: true };
}

export async function uploadSignupLogo(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const who = await requireOrglessBuyer();
  if (!who.ok) return who;

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };

  const bytes = Buffer.from(await file.arrayBuffer());
  // Same validator the Settings → Branding upload uses: MIME allow-list, size
  // cap, and a magic-byte sniff that must agree with the declared type.
  const check = validateLogo({ mime: file.type, bytes });
  if (!check.ok) return check;

  let url: string;
  try {
    ({ url } = await putSignupBrandingAsset({
      userId: who.userId,
      kind: "logo",
      bytes,
      contentType: file.type,
    }));
  } catch (err) {
    // Never let a Blob failure escape a server action — an uncaught throw takes
    // out the whole page via the error boundary instead of showing an inline
    // message, and branding is the OPTIONAL half of this step.
    console.error("[welcome] logo upload failed:", err);
    return { ok: false, error: "Upload failed. Please try again." };
  }

  await writePendingSignup(who.userId, { logoUrl: url });
  return { ok: true, url };
}

export async function startSignupCheckout(): Promise<ActionResult<{ url: string }>> {
  const who = await requireOrglessBuyer();
  if (!who.ok) return who;

  // Authenticated path, so key the budget on the user rather than the IP —
  // a firm behind one NAT should not throttle itself.
  const rl = await checkCheckoutSessionRateLimit(`user:${who.userId}`);
  if (!rl.allowed) {
    return { ok: false, error: "Too many attempts. Please wait a moment and try again." };
  }

  const profile = await readPendingSignup(who.userId);
  if (!profile) return { ok: false, error: "Enter your firm name to continue." };

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        priceKey: PLAN_PRICE_KEY[profile.plan],
        origin: appUrl(),
        // The whole point: the webhook adds THIS person to the new firm rather
        // than emailing an invitation to whatever address Stripe collects.
        clientReferenceId: who.userId,
      }),
    );
    if (!session.url) throw new Error("Stripe returned a session with no URL");
    return { ok: true, url: session.url };
  } catch (err) {
    console.error("[welcome] could not start Checkout:", err);
    return { ok: false, error: "We couldn't reach payments. Please try again in a moment." };
  }
}
