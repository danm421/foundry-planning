// src/lib/billing/email-templates.tsx
import type { BillingEmailKind } from "@/lib/billing/email-stub";

/**
 * Pure HTML builders for the three billing notification kinds. Returns a
 * { subject, html } pair Resend can send verbatim — no React render step, no
 * IO, no env reads, so each kind is table-testable. The app base URL is read
 * from NEXT_PUBLIC_APP_URL at call time but defaults to the production host so
 * a missing env never emits a broken link.
 */

type TemplatePayload = Record<string, unknown>;

export type RenderedEmail = { subject: string; html: string };

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

function str(payload: TemplatePayload, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function shell(heading: string, bodyHtml: string, cta: { href: string; label: string }): string {
  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;">`,
    `<h1 style="font-size:18px;font-weight:600;margin:0 0 16px;">${heading}</h1>`,
    bodyHtml,
    `<p style="margin:24px 0;"><a href="${cta.href}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;">${cta.label}</a></p>`,
    `<p style="font-size:12px;color:#6b7280;margin-top:32px;">Foundry Planning · You're receiving this because you manage billing for your firm.</p>`,
    `</div>`,
  ].join("");
}

export function renderBillingEmail(
  kind: BillingEmailKind,
  payload: TemplatePayload,
): RenderedEmail {
  const billingPage = `${appUrl()}/settings/billing`;

  if (kind === "payment_failed") {
    const recoveryUrl = str(payload, "invoiceUrl") ?? billingPage;
    return {
      subject: "Action needed: your Foundry Planning payment failed",
      html: shell(
        "Your payment didn't go through",
        `<p style="font-size:14px;line-height:1.6;">We couldn't process your most recent subscription payment. Update your card or retry the charge to keep your firm's access active. We'll automatically retry over the next few days.</p><p style="font-size:13px;"><a href="${billingPage}" style="color:#0f172a;">Manage billing settings</a></p>`,
        { href: recoveryUrl, label: "Update payment method" },
      ),
    };
  }

  if (kind === "trial_ending_3d") {
    const trialEnd = str(payload, "trialEnd");
    const when = trialEnd ? trialEnd.slice(0, 10) : "in 3 days";
    return {
      subject: "Your Foundry Planning trial ends soon",
      html: shell(
        "Your free trial is ending",
        `<p style="font-size:14px;line-height:1.6;">Your trial ends ${when}. Your subscription will start automatically and your firm keeps full access. Manage your plan or payment method any time from your billing settings.</p>`,
        { href: billingPage, label: "Manage billing" },
      ),
    };
  }

  // payment_action_required (3DS / SCA)
  const confirmUrl = str(payload, "invoiceUrl") ?? billingPage;
  return {
    subject: "Confirm your Foundry Planning payment",
    html: shell(
      "One more step to confirm your payment",
      `<p style="font-size:14px;line-height:1.6;">Your bank needs you to verify this payment before it can complete. Confirm it now to keep your firm's access uninterrupted.</p>`,
      { href: confirmUrl, label: "Confirm payment" },
    ),
  };
}
