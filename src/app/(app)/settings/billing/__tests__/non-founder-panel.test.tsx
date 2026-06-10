// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/billing/subscription-state", () => ({
  getSubscriptionState: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

import { NonFounderBillingPanel, type InvoiceRow } from "../page";
import { auth } from "@clerk/nextjs/server";
import { getSubscriptionState } from "@/lib/billing/subscription-state";
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
  });

  it("renders the subscription status and the Manage billing form", async () => {
    mockInvoices([]);
    const node = await NonFounderBillingPanel();
    render(node);

    expect(screen.getAllByText(/billing/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/active/i)).not.toBeNull();
    const button = screen.getByRole("button", { name: /manage billing/i });
    expect(button.getAttribute("type")).toBe("submit");
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
