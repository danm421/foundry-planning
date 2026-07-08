// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlaidConsentNotice } from "../plaid-consent-notice";

describe("PlaidConsentNotice", () => {
  it("discloses that Foundry uses Plaid", () => {
    render(<PlaidConsentNotice />);
    expect(
      screen.getByText(/Foundry uses Plaid to securely connect your accounts/i),
    ).toBeDefined();
  });

  it("links Foundry's Privacy Policy in a new tab", () => {
    render(<PlaidConsentNotice />);
    const link = screen.getByRole("link", { name: "Privacy Policy" });
    expect(link.getAttribute("href")).toBe(
      "https://foundryplanning.com/legal/privacy",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("links Plaid's End User Privacy Policy in a new tab", () => {
    render(<PlaidConsentNotice />);
    const link = screen.getByRole("link", { name: "End User Privacy Policy" });
    expect(link.getAttribute("href")).toBe(
      "https://plaid.com/legal/#end-user-privacy-policy",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
