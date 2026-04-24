// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@clerk/nextjs", () => ({
  UserButton: ({ appearance }: { appearance?: unknown }) => (
    <div data-testid="clerk-user-button" data-appearance={appearance ? "yes" : "no"} />
  ),
}));

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

  it("hides when collapsed", () => {
    const { container } = render(<UserMenu collapsed />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("hidden");
  });
});
