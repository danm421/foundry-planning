// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/billing/subscription-state", () => ({
  getSubscriptionState: vi.fn(),
}));
vi.mock("@/lib/billing/plan-switch", () => ({
  readPlanSwitchState: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
// The panel pulls in the resubscribe client component, which imports the
// server action (clerk/db/Stripe). Stub the action module, not the component —
// the component IS what we want to assert renders.
vi.mock("../actions", () => ({
  startResubscribeCheckout: vi.fn(),
  confirmPlanSwitchAction: vi.fn(),
  cancelPlanSwitchAction: vi.fn(),
}));

import { NonFounderBillingPanel, type InvoiceRow } from "../page";
import { auth } from "@clerk/nextjs/server";
import { getSubscriptionState } from "@/lib/billing/subscription-state";
import { readPlanSwitchState } from "@/lib/billing/plan-switch";
import { db } from "@/db";

function mockInvoices(rows: InvoiceRow[]) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  } as never);
}

describe("<NonFounderBillingPanel>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ orgId: "org_abc" } as never);
    vi.mocked(getSubscriptionState).mockResolvedValue({ kind: "active" });
    vi.mocked(readPlanSwitchState).mockResolvedValue({ kind: "none", currentPlan: "annual" });
  });

  it("renders the subscription status and the Manage billing form", async () => {
    mockInvoices([]);
    const node = await NonFounderBillingPanel();
    render(node);

    expect(screen.getAllByText(/billing/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/active/i)).not.toBeNull();
    // The switch is a link to the in-app confirm screen now, not a POST to Stripe.
    const link = screen.getByRole("link", { name: /switch to monthly/i });
    expect(link.getAttribute("href")).toBe("/settings/billing/switch?plan=monthly");
  });

  it("lists invoices with a link to the Stripe-hosted invoice", async () => {
    mockInvoices([
      {
        stripeInvoiceId: "in_1",
        amountPaid: 19900,
        amountDue: 19900,
        currency: "usd",
        status: "paid",
        paidAt: new Date("2026-05-01T00:00:00Z"),
        createdAt: new Date("2026-05-01T00:00:00Z"),
        hostedInvoiceUrl: "https://invoice.stripe.com/i/in_1",
        invoicePdf: "https://invoice.stripe.com/i/in_1/pdf",
      },
    ]);
    const node = await NonFounderBillingPanel();
    render(node);

    expect(screen.getByText(/\$199\.00/)).not.toBeNull();
    const link = screen.getByRole("link", { name: /view/i });
    expect(link.getAttribute("href")).toBe("https://invoice.stripe.com/i/in_1");
  });

  it("shows an empty-state line when there are no invoices", async () => {
    mockInvoices([]);
    const node = await NonFounderBillingPanel();
    render(node);
    expect(screen.getByText(/no invoices yet/i)).not.toBeNull();
  });

  it("renders without a customer link when orgId is missing", async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null } as never);
    mockInvoices([]);
    const node = await NonFounderBillingPanel();
    render(node);
    // Still renders the heading + manage button; invoice query is skipped.
    expect(screen.getAllByText(/billing/i).length).toBeGreaterThan(0);
    const region = screen.getByText(/no invoices yet/i);
    expect(within(region.closest("section")!).queryByRole("link")).toBeNull();
  });
});

describe("<NonFounderBillingPanel> when a comp has ended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ orgId: "org_abc" } as never);
    vi.mocked(getSubscriptionState).mockResolvedValue({ kind: "comp_ended" });
  });

  it("offers a real Subscribe button, not the support dead-end", async () => {
    const node = await NonFounderBillingPanel();
    render(node);
    // The gap this whole feature closes: before it, a de-comped firm read as
    // `missing` and this page answered "contact support".
    expect(screen.getByRole("button", { name: /subscribe/i })).not.toBeNull();
    expect(screen.queryByText(/contact support/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("leads with the data still being there, not with a lockout", async () => {
    const node = await NonFounderBillingPanel();
    render(node);
    expect(screen.getByText(/still here and still readable/i)).not.toBeNull();
  });

  it("lets them choose a billing period", async () => {
    const node = await NonFounderBillingPanel();
    render(node);
    expect(screen.getByRole("radio", { name: /annual/i })).not.toBeNull();
    expect(screen.getByRole("radio", { name: /monthly/i })).not.toBeNull();
  });

  it("never runs the invoice query — a comped firm has no invoices to show", async () => {
    const node = await NonFounderBillingPanel();
    render(node);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("shows no checkout confirmation on a normal visit", async () => {
    const node = await NonFounderBillingPanel();
    render(node);
    expect(screen.queryByText(/payment received/i)).toBeNull();
  });
});
