// src/lib/clients/send-portal-signin-link.ts
//
// Email a client a one-time link back into their portal — the advisor-side
// answer to "I forgot my password" / "the reset email never arrived".
//
// Clerk's Backend API has no "send a password reset email" call, so this uses
// the supported equivalent: a single-use sign-in token, redeemed by the Clerk
// `<SignIn/>` component via `?__clerk_ticket=`. The client lands in the portal
// signed in and can set a new password from the Clerk account menu.
//
// Transport and branding come from @/lib/intake — same Resend client, same
// HTML shell, same From-header resolution — rather than introducing another
// mailer, exactly as src/lib/risk/email.ts does for the questionnaire link.
// That is also what keeps a white-labelled firm's clients seeing THEIR firm on
// this email and not Foundry.
import { clerkClient } from "@clerk/nextjs/server";
import { Resend } from "resend";
import { buildIntakeEmailHtml, buildIntakeFromHeader } from "@/lib/intake/email-template";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { recordAudit } from "@/lib/audit";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";

/** How long a sign-in link stays usable. Short on purpose: the link IS the
 *  credential — anyone holding it is signed in as the client. It is single-use
 *  (Clerk revokes the token on redemption) and the advisor can resend. */
export const SIGNIN_LINK_TTL_SECONDS = 3600;

export const PORTAL_SIGNIN_SUBJECT = "Your sign-in link for the client portal";

/** Passed as buildIntakeEmailHtml's `introBody` override — the default
 *  (DEFAULT_INTAKE_INTRO) describes a data-collection form, not a login.
 *  `{{advisorName}}` / `{{firmName}}` are substituted by the template, escaped. */
export function buildSignInIntro(ttlSeconds: number = SIGNIN_LINK_TTL_SECONDS): string {
  const hours = Math.max(1, Math.round(ttlSeconds / 3600));
  const validFor = hours === 1 ? "the next hour" : `the next ${hours} hours`;
  return (
    `{{advisorName}} sent you a link to get back into your portal. It signs ` +
    `you in without a password and works once, within ${validFor}.\n\n` +
    `Once you are in, you can set a new password from the account menu in the ` +
    `top corner. If you did not ask for this, you can ignore this email — the ` +
    `link expires on its own.`
  );
}

/**
 * Mint a sign-in token for `clerkUserId` and email the ticket link to `email`.
 *
 * REPORTS delivery rather than swallowing it (unlike sendIntakeFormEmail): the
 * advisor is standing at a button, and a silent success on an unsent email
 * reads as "the client has a link" when nobody has one. On a failed send the
 * token is revoked, so a dead button never leaves a live credential behind.
 *
 * Callers are responsible for verifying `clientId` belongs to `firmId` and for
 * rate limiting BEFORE calling.
 */
export async function sendPortalSignInLink(args: {
  clientId: string;
  clerkUserId: string;
  email: string;
  clientName?: string | null;
  advisorName?: string | null;
  advisorEmail?: string | null;
  firmName?: string | null;
  firmId: string;
  callerOrg: string | null;
  access: "own" | "shared";
}): Promise<{ delivered: boolean; reason?: "unconfigured" | "send_failed" }> {
  const { clientId, clerkUserId, email, firmId, callerOrg, access } = args;

  const cc = await clerkClient();
  const token = await cc.signInTokens.createSignInToken({
    userId: clerkUserId,
    expiresInSeconds: SIGNIN_LINK_TTL_SECONDS,
  });

  // encodeURIComponent, not raw: a Clerk token can carry "+" and "/", which a
  // bare query string would mangle into a ticket Clerk then rejects.
  const link = `${APP_URL}/sign-in?__clerk_ticket=${encodeURIComponent(token.token)}`;
  const html = buildIntakeEmailHtml({
    link,
    introBody: buildSignInIntro(),
    ctaLabel: "Sign in to my portal",
    advisorName: args.advisorName ?? undefined,
    advisorEmail: args.advisorEmail ?? undefined,
    firmName: args.firmName ?? undefined,
    clientName: args.clientName ?? undefined,
  });

  const result = await deliver({
    to: email,
    html,
    from: buildIntakeFromHeader(undefined, args.firmName ?? undefined),
  });

  if (!result.delivered) {
    // Don't leave a usable credential sitting in Clerk for an email nobody got.
    try {
      await cc.signInTokens.revokeSignInToken(token.id);
    } catch (err) {
      console.error(
        "[portal-signin-link] revoke after failed send failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return result;
  }

  await recordAudit({
    action: "portal.signin_link.sent",
    resourceType: "portal_binding",
    resourceId: clientId,
    clientId,
    firmId,
    actorKind: "advisor",
    // No token in the metadata — the audit log is advisor-readable.
    metadata: crossFirmAuditMeta({ access }, callerOrg, {
      email,
      expiresInSeconds: SIGNIN_LINK_TTL_SECONDS,
    }),
  });

  return { delivered: true };
}

async function deliver(args: {
  to: string;
  from: string;
  html: string;
}): Promise<{ delivered: boolean; reason?: "unconfigured" | "send_failed" }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      "[portal-signin-link] RESEND_API_KEY is not set — the sign-in link cannot send",
    );
    return { delivered: false, reason: "unconfigured" };
  }
  try {
    const resend = new Resend(apiKey);
    // resend.emails.send() resolves { data: null, error } for every non-2xx
    // response rather than throwing — the `error` check is the real net.
    const { error } = await resend.emails.send({
      from: args.from,
      to: args.to,
      subject: PORTAL_SIGNIN_SUBJECT,
      html: args.html,
    });
    if (error) {
      console.error(
        "[portal-signin-link] Resend rejected the send:",
        error.message ?? error,
      );
      return { delivered: false, reason: "send_failed" };
    }
    return { delivered: true };
  } catch (err) {
    console.error(
      "[portal-signin-link] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false, reason: "send_failed" };
  }
}
