// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { PLAID_OAUTH_CTX_KEY } from "@/lib/portal/plaid-link-complete";

// vi.mock is hoisted above these declarations, so the boxes it closes over must
// come from vi.hoisted() — a plain `const` would be in its TDZ when the factory
// fires.
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  linkArgs: null as { onExit?: () => void } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => vi.fn(),
}));

// Capture the callbacks the component hands Link so a test can drive them.
// `ready: false` keeps the auto-open effect from firing.
vi.mock("react-plaid-link", () => ({
  usePlaidLink: (args: { onExit?: () => void }) => {
    mocks.linkArgs = args;
    return { open: vi.fn(), ready: false };
  },
}));

vi.mock("../plaid-account-picker", () => ({
  PlaidAccountPicker: () => <div data-testid="picker" />,
}));

beforeEach(() => {
  sessionStorage.clear();
  mocks.replace.mockClear();
  mocks.refresh.mockClear();
  mocks.linkArgs = null;
});

describe("PlaidOAuthResume", () => {
  it("shows 'Nothing to resume' with a link back when no context is stored", async () => {
    const { PlaidOAuthResume } = await import("../plaid-oauth-resume");
    render(<PlaidOAuthResume />);
    expect(await screen.findByText(/nothing to resume/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to accounts/i }),
    ).toHaveAttribute("href", "/portal/organizer/accounts");
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

  // The `router.replace` half of ACCOUNTS_PATH — the OAuth completion hop. It
  // must land on the Organizer tab directly, not on the legacy /portal/accounts
  // shim, which resolves as a meta refresh inside a 200 (a second full load).
  it("returns to the Organizer accounts tab when Link exits", async () => {
    sessionStorage.setItem(
      PLAID_OAUTH_CTX_KEY,
      JSON.stringify({ token: "link-abc", mode: "link" }),
    );
    const { PlaidOAuthResume } = await import("../plaid-oauth-resume");
    render(<PlaidOAuthResume />);

    mocks.linkArgs?.onExit?.();

    expect(mocks.replace).toHaveBeenCalledWith("/portal/organizer/accounts");
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
