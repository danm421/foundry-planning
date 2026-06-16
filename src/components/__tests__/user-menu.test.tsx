// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render } from "@testing-library/react";

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
  return { UserButton };
});

import UserMenu from "../user-menu";

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
