// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ManageBillingButton from "../manage-billing-button";

describe("<ManageBillingButton>", () => {
  it("renders a POST form targeting the portal route", () => {
    const { container } = render(<ManageBillingButton />);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form!.getAttribute("method")).toBe("post");
    expect(form!.getAttribute("action")).toBe("/api/billing/portal");
  });

  it("renders a submit button labelled Manage billing", () => {
    render(<ManageBillingButton />);
    const button = screen.getByRole("button", { name: /manage billing/i });
    expect(button).not.toBeNull();
    expect(button.getAttribute("type")).toBe("submit");
  });
});
