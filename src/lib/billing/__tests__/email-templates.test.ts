// src/lib/billing/__tests__/email-templates.test.ts
import { describe, it, expect } from "vitest";
import { renderBillingEmail } from "../email-templates";

describe("renderBillingEmail", () => {
  it("payment_failed includes the invoice URL and a recovery CTA", () => {
    const { subject, html } = renderBillingEmail("payment_failed", {
      invoiceUrl: "https://invoice.stripe.com/i/abc",
      invoiceId: "in_abc",
    });
    expect(subject).toMatch(/payment/i);
    expect(html).toContain("https://invoice.stripe.com/i/abc");
    expect(html).toContain("/settings/billing");
  });

  it("trial_ending_3d names the trial end date", () => {
    const { subject, html } = renderBillingEmail("trial_ending_3d", {
      trialEnd: "2026-06-20T00:00:00.000Z",
    });
    expect(subject).toMatch(/trial/i);
    expect(html).toContain("2026-06-20");
  });

  it("payment_action_required surfaces the 3DS recovery link", () => {
    const { subject, html } = renderBillingEmail("payment_action_required", {
      invoiceUrl: "https://invoice.stripe.com/i/xyz",
      invoiceId: "in_xyz",
    });
    expect(subject).toMatch(/action|confirm|verify/i);
    expect(html).toContain("https://invoice.stripe.com/i/xyz");
  });

  it("falls back to the billing page when no invoice URL is present", () => {
    const { html } = renderBillingEmail("payment_failed", {
      invoiceUrl: null,
      invoiceId: "in_no_url",
    });
    expect(html).toContain("/settings/billing");
    expect(html).not.toContain("null");
  });
});
