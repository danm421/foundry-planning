// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn().mockReturnValue("/clients"),
}));

import Topbar from "../topbar";

describe("Topbar", () => {
  it("renders a sticky header", () => {
    const { container } = render(<Topbar />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("sticky");
    expect(el.className).toContain("top-0");
  });

  it("renders three disabled action buttons", () => {
    const { container } = render(<Topbar />);
    const disabledButtons = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.hasAttribute("disabled"),
    );
    expect(disabledButtons).toHaveLength(3);
    disabledButtons.forEach((b) => {
      expect(b.getAttribute("title")).toBe("Coming soon");
    });
  });

  it("renders a sidebar toggle button", () => {
    const { container } = render(<Topbar />);
    const toggle = container.querySelector('button[aria-label="Toggle sidebar"]');
    expect(toggle).not.toBeNull();
  });

  it("labels the three buttons Share / Export / Prep for meeting", () => {
    const { container } = render(<Topbar />);
    expect(container.textContent).toContain("Share");
    expect(container.textContent).toContain("Export");
    expect(container.textContent).toContain("Prep for meeting");
  });

  it("highlights Prep for meeting as the primary button", () => {
    const { container } = render(<Topbar />);
    const prep = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Prep for meeting"),
    );
    expect(prep?.className).toContain("bg-accent");
  });

  it("renders the breadcrumb in the left slot", () => {
    const { container } = render(<Topbar />);
    expect(container.textContent).toContain("Clients");
  });
});
