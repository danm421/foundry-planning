// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { PLAID_OAUTH_CTX_KEY } from "@/lib/portal/plaid-link-complete";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => vi.fn(),
}));

vi.mock("react-plaid-link", () => ({
  usePlaidLink: () => ({ open: vi.fn(), ready: false }),
}));

vi.mock("../plaid-account-picker", () => ({
  PlaidAccountPicker: () => <div data-testid="picker" />,
}));

beforeEach(() => {
  sessionStorage.clear();
});

describe("PlaidOAuthResume", () => {
  it("shows 'Nothing to resume' with a link back when no context is stored", async () => {
    const { PlaidOAuthResume } = await import("../plaid-oauth-resume");
    render(<PlaidOAuthResume />);
    expect(await screen.findByText(/nothing to resume/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to accounts/i }),
    ).toHaveAttribute("href", "/portal/accounts");
  });

  it("shows the finishing state while a stored context resumes", async () => {
    sessionStorage.setItem(
      PLAID_OAUTH_CTX_KEY,
      JSON.stringify({ token: "link-abc", mode: "link" }),
    );
    const { PlaidOAuthResume } = await import("../plaid-oauth-resume");
    render(<PlaidOAuthResume />);
    expect(
      await screen.findByText(/finishing up with your bank/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nothing to resume/i)).toBeNull();
  });
});
