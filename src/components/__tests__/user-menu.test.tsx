// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockUseAuth = vi.fn();
const mockSignOut = vi.fn();
const mockEndImpersonation = vi.fn();
vi.mock("@/app/(app)/_impersonation", () => ({
  endImpersonationAction: () => mockEndImpersonation(),
}));

vi.mock("@clerk/nextjs", () => {
  const UserButton = ({
    appearance,
    children,
  }: {
    appearance?: unknown;
    children?: ReactNode;
  }) => (
    <div data-testid="clerk-user-button" data-appearance={appearance ? "yes" : "no"}>
      {children}
    </div>
  );
  UserButton.MenuItems = function MenuItems({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  };
  UserButton.Link = function Link({ label, href }: { label: string; href: string }) {
    return (
      <a data-testid="ops-link" href={href}>
        {label}
      </a>
    );
  };
  return {
    UserButton,
    useAuth: () => mockUseAuth(),
    useClerk: () => ({ signOut: mockSignOut }),
  };
});

import UserMenu from "../user-menu";

beforeEach(() => {
  mockUseAuth.mockReset().mockReturnValue({ actor: null });
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockEndImpersonation.mockReset().mockResolvedValue(undefined);
});

describe("UserMenu", () => {
  it("renders the Clerk UserButton", () => {
    const { container } = render(<UserMenu />);
    expect(container.querySelector('[data-testid="clerk-user-button"]')).not.toBeNull();
  });

  it("passes an appearance config", () => {
    const { container } = render(<UserMenu />);
    const btn = container.querySelector('[data-testid="clerk-user-button"]');
    expect(btn?.getAttribute("data-appearance")).toBe("yes");
  });

  it("shows the Foundry Ops link for ops admins", () => {
    const { container } = render(<UserMenu isOpsAdmin />);
    const link = container.querySelector('[data-testid="ops-link"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/admin");
    expect(link?.textContent).toContain("Foundry Ops");
  });

  it("hides the Foundry Ops link for non-admins", () => {
    const { container } = render(<UserMenu isOpsAdmin={false} />);
    expect(container.querySelector('[data-testid="ops-link"]')).toBeNull();
  });

  it("hides the Foundry Ops link by default", () => {
    const { container } = render(<UserMenu />);
    expect(container.querySelector('[data-testid="ops-link"]')).toBeNull();
  });
});

describe("UserMenu while an operator is signed in as this user", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ actor: { sub: "user_op" } });
  });

  it("offers no account menu (profile, security) — only a way out", () => {
    const { container } = render(<UserMenu isOpsAdmin />);
    expect(container.querySelector('[data-testid="clerk-user-button"]')).toBeNull();
    expect(screen.getByRole("button", { name: /end session/i })).not.toBeNull();
  });

  it("ends the session the way the impersonation banner does", async () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByRole("button", { name: /end session/i }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ redirectUrl: "/admin/orgs" }));
    expect(mockEndImpersonation).toHaveBeenCalledTimes(1);
  });
});
