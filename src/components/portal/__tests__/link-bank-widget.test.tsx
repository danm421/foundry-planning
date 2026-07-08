// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub the dynamic Plaid button + account picker so the test focuses on
// placement of the consent notice (which is rendered for real).
vi.mock("../plaid-link-button-dynamic", () => ({
  PlaidLinkButton: () => <button type="button">Link bank</button>,
}));
vi.mock("../plaid-account-picker", () => ({
  PlaidAccountPicker: () => null,
}));

import { LinkBankWidget } from "../link-bank-widget";

describe("LinkBankWidget", () => {
  it("renders the Plaid consent notice alongside the link button", () => {
    render(<LinkBankWidget />);
    expect(screen.getByRole("button", { name: /Link bank/i })).toBeDefined();
    expect(
      screen.getByText(/Foundry uses Plaid to securely connect your accounts/i),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "End User Privacy Policy" }),
    ).toBeDefined();
  });
});
