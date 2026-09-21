// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../actions", () => ({
  confirmPlanSwitchAction: vi.fn(),
  cancelPlanSwitchAction: vi.fn(),
  startResubscribeCheckout: vi.fn(),
}));

import ManageBillingButton from "../manage-billing-button";

describe("<ManageBillingButton>", () => {
  it("links to the in-app confirm screen, not to Stripe", () => {
    render(
      <ManageBillingButton switchState={{ kind: "none", currentPlan: "annual" }} canSwitch />,
    );
    const link = screen.getByRole("link", { name: /switch to monthly/i });
    expect(link.getAttribute("href")).toBe("/settings/billing/switch?plan=monthly");
  });

  it("offers annual when the current cycle is monthly", () => {
    render(
      <ManageBillingButton switchState={{ kind: "none", currentPlan: "monthly" }} canSwitch />,
    );
    expect(screen.getByRole("link", { name: /switch to annual/i })).not.toBeNull();
  });

  it("keeps cancellation and payment management on the Stripe portal", () => {
    const { container } = render(
      <ManageBillingButton switchState={{ kind: "none", currentPlan: "annual" }} canSwitch />,
    );
    const form = container.querySelector('form[action="/api/billing/portal"]');
    expect(form?.getAttribute("method")).toBe("post");
    expect(
      screen.getByRole("button", { name: /cards, invoices & cancellation/i }),
    ).not.toBeNull();
  });

  it("shows a pending change and offers cancel INSTEAD of a contradictory switch", () => {
    render(
      <ManageBillingButton
        switchState={{
          kind: "pending",
          currentPlan: "annual",
          targetPlan: "monthly",
          effectiveAt: new Date("2027-09-21T00:00:00Z"),
          scheduleId: "sub_sched_1",
        }}
        canSwitch
      />,
    );
    expect(screen.getByText(/switching to/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: /cancel scheduled change/i })).not.toBeNull();
    expect(screen.queryByRole("link", { name: /switch to/i })).toBeNull();
  });

  it("hides the switch control when Stripe could not be read", () => {
    render(<ManageBillingButton switchState={{ kind: "unavailable" }} canSwitch />);
    expect(screen.queryByRole("link", { name: /switch to/i })).toBeNull();
    expect(screen.getByText(/couldn't reach stripe/i)).not.toBeNull();
  });

  it("does not offer a switch when the subscription state cannot change plans", () => {
    render(
      <ManageBillingButton
        switchState={{ kind: "none", currentPlan: "annual" }}
        canSwitch={false}
      />,
    );
    expect(screen.queryByRole("link", { name: /switch to/i })).toBeNull();
  });
});
