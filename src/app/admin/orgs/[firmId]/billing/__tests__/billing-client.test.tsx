// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The client imports the server actions, which pull in clerk/db/audit/Stripe.
vi.mock("../actions", () => ({
  openPortalAction: vi.fn(),
  extendTrialAction: vi.fn(),
  compToFounderAction: vi.fn(),
}));

import type { ComponentProps } from "react";
import BillingClient from "../billing-client";
import type { FirmBilling } from "@/lib/ops/billing-admin";

function billing(over: Partial<FirmBilling> = {}): FirmBilling {
  return {
    state: { kind: "trialing", trialEndsAt: new Date("2026-09-24T00:00:00Z") },
    subscription: {
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      status: "trialing",
      trialEnd: new Date("2026-09-24T00:00:00Z"),
      currentPeriodEnd: new Date("2026-09-24T00:00:00Z"),
      cancelAtPeriodEnd: false,
    },
    invoices: [],
    stripeCustomerId: "cus_1",
    dashboardUrl: "https://dashboard.stripe.com/customers/cus_1",
    canExtendTrial: true,
    ...over,
  };
}

function renderClient(over: Partial<ComponentProps<typeof BillingClient>> = {}) {
  return render(
    <BillingClient firmId="org_1" isFounder={false} billing={billing()} {...over} />,
  );
}

const compButton = () => screen.getByRole("button", { name: /comp to founder/i });
// The extend-trial form also renders a "Reason (required)" box, so the comp
// form's own field is addressed by the part of its placeholder that is unique.
const compReason = () => screen.getByPlaceholderText(/recorded in the audit log/i);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<BillingClient> comp-to-founder form", () => {
  it("offers the comp on a paying firm", () => {
    renderClient();
    expect(compButton()).toBeTruthy();
  });

  it("hides the comp entirely once the firm is already a founder", () => {
    renderClient({ isFounder: true });
    expect(screen.queryByRole("button", { name: /comp to founder/i })).toBeNull();
  });

  it("warns that the comp cannot be undone", () => {
    renderClient();
    expect(screen.getByText(/no undo/i)).toBeTruthy();
  });

  it("stays disabled until BOTH a reason and the acknowledgement are given", async () => {
    const user = userEvent.setup();
    renderClient();
    expect(compButton()).toHaveProperty("disabled", true);

    // Reason alone is not enough.
    await user.type(compReason(), "design partner");
    expect(compButton()).toHaveProperty("disabled", true);

    // Acknowledgement alone is not enough either.
    await user.clear(compReason());
    await user.click(screen.getByRole("checkbox"));
    expect(compButton()).toHaveProperty("disabled", true);

    // Both together unlock it.
    await user.type(compReason(), "design partner");
    expect(compButton()).toHaveProperty("disabled", false);
  });

  it("does not accept whitespace as a reason", async () => {
    const user = userEvent.setup();
    renderClient();
    await user.click(screen.getByRole("checkbox"));
    await user.type(compReason(), "   ");
    expect(compButton()).toHaveProperty("disabled", true);
  });

  it("carries the firm id so the action targets the right org", () => {
    const { container } = renderClient();
    const hidden = container.querySelector<HTMLInputElement>('input[name="firmId"][type="hidden"]');
    expect(hidden?.value).toBe("org_1");
  });
});
