// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireBillingContact: vi.fn() };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/billing/plan-switch", () => ({ readPlanSwitchPreview: vi.fn() }));
vi.mock("../actions", () => ({
  confirmPlanSwitchAction: vi.fn(),
  cancelPlanSwitchAction: vi.fn(),
  startResubscribeCheckout: vi.fn(),
}));

import SwitchPage from "../switch/page";
import { auth } from "@clerk/nextjs/server";
import { requireBillingContact } from "@/lib/authz";
import { readPlanSwitchPreview } from "@/lib/billing/plan-switch";

describe("/settings/billing/switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireBillingContact).mockResolvedValue(undefined);
    vi.mocked(auth).mockResolvedValue({ orgId: "org_1" } as never);
  });

  it("tells a paid subscriber what they keep, what comes next, and that nothing is due", async () => {
    vi.mocked(readPlanSwitchPreview).mockResolvedValue({
      ok: true,
      preview: {
        mode: "scheduled",
        currentPlan: "annual",
        plan: "monthly",
        effectiveAt: new Date("2027-09-21T00:00:00Z"),
        unitAmount: 19900,
        currency: "usd",
        dueToday: 0,
      },
    } as never);

    render(await SwitchPage({ searchParams: Promise.resolve({ plan: "monthly" }) }));

    expect(screen.getByText(/you stay on annual until/i)).not.toBeNull();
    expect(screen.getByText(/from then you'll be billed/i)).not.toBeNull();
    expect(screen.getByText(/nothing is due today/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: /switch to monthly/i })).not.toBeNull();
  });

  it("tells a trialing subscriber the change is now and names the first bill", async () => {
    vi.mocked(readPlanSwitchPreview).mockResolvedValue({
      ok: true,
      preview: {
        mode: "immediate",
        currentPlan: "annual",
        plan: "monthly",
        effectiveAt: new Date("2026-10-05T00:00:00Z"),
        unitAmount: 19900,
        currency: "usd",
        dueToday: 0,
      },
    } as never);

    render(await SwitchPage({ searchParams: Promise.resolve({ plan: "monthly" }) }));

    expect(screen.getByText(/your plan changes to monthly now/i)).not.toBeNull();
    expect(screen.getByText(/your first bill is/i)).not.toBeNull();
  });

  it("refuses an unknown plan without calling Stripe", async () => {
    render(await SwitchPage({ searchParams: Promise.resolve({ plan: "weekly" }) }));
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(vi.mocked(readPlanSwitchPreview)).not.toHaveBeenCalled();
  });

  it("does not offer a confirm button when Stripe cannot be reached", async () => {
    vi.mocked(readPlanSwitchPreview).mockResolvedValue({
      ok: false,
      reason: "unavailable",
    } as never);

    render(await SwitchPage({ searchParams: Promise.resolve({ plan: "monthly" }) }));

    expect(screen.queryByRole("button", { name: /switch to/i })).toBeNull();
    expect(screen.getByRole("alert")).not.toBeNull();
  });

  it("sends someone with a pending change back rather than stacking a second one", async () => {
    vi.mocked(readPlanSwitchPreview).mockResolvedValue({
      ok: false,
      reason: "pending_exists",
    } as never);

    render(await SwitchPage({ searchParams: Promise.resolve({ plan: "monthly" }) }));

    expect(screen.getByRole("alert").textContent).toMatch(/already have a change scheduled/i);
    expect(screen.queryByRole("button", { name: /switch to/i })).toBeNull();
  });
});
