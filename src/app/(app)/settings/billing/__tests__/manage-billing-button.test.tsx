// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ManageBillingButton from "../manage-billing-button";

describe("<ManageBillingButton>", () => {
  it("renders a POST form targeting the portal route", () => {
    const { container } = render(<ManageBillingButton currentPlan="annual" canSwitch />);
    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form.getAttribute("method")).toBe("post");
      expect(form.getAttribute("action")).toBe("/api/billing/portal");
    }
  });

  it("offers monthly when the current cycle is annual", () => {
    render(<ManageBillingButton currentPlan="annual" canSwitch />);
    const button = screen.getByRole("button", { name: /switch to monthly/i });
    expect(button.getAttribute("type")).toBe("submit");
    const form = button.closest("form");
    expect(form?.querySelector<HTMLInputElement>('input[name="plan"]')?.value).toBe("monthly");
  });

  it("offers annual when the current cycle is monthly", () => {
    render(<ManageBillingButton currentPlan="monthly" canSwitch />);
    expect(screen.getByRole("button", { name: /switch to annual/i })).not.toBeNull();
  });

  it("keeps cancellation and payment management available", () => {
    render(<ManageBillingButton currentPlan="annual" canSwitch />);
    expect(
      screen.getByRole("button", { name: /cards, invoices & cancellation/i }),
    ).not.toBeNull();
  });

  it("does not offer a switch when the subscription state cannot change plans", () => {
    render(<ManageBillingButton currentPlan="annual" canSwitch={false} />);
    expect(screen.queryByRole("button", { name: /switch to/i })).toBeNull();
  });
});
