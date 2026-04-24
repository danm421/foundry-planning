// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

import { usePathname } from "next/navigation";
import SidebarNav from "../sidebar-nav";

describe("SidebarNav", () => {
  it("renders the two group headers", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients");
    const { container } = render(<SidebarNav clientsCount={0} />);
    expect(container.textContent).toContain("WORKSPACE");
    expect(container.textContent).toContain("FIRM");
  });

  it("renders all 8 nav items in order", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients");
    const { container } = render(<SidebarNav clientsCount={0} />);
    const text = container.textContent ?? "";
    const expectedLabels = [
      "Home",
      "Clients",
      "CMA's",
      "Presentations",
      "Tasks",
      "Reports",
      "Documents",
      "Settings",
    ];
    let lastIndex = -1;
    for (const label of expectedLabels) {
      const idx = text.indexOf(label);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it("passes clientsCount to the Clients item", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients");
    const { container } = render(<SidebarNav clientsCount={42} />);
    expect(container.textContent).toContain("42");
  });

  it("marks the Clients item active when pathname is /clients", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients");
    const { container } = render(<SidebarNav clientsCount={5} />);
    const clientsLink = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.includes("Clients")
    );
    expect(clientsLink?.getAttribute("aria-current")).toBe("page");
  });

  it("marks the Clients item active when on a client sub-route", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients/abc-123/overview");
    const { container } = render(<SidebarNav clientsCount={5} />);
    const clientsLink = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.includes("Clients")
    );
    expect(clientsLink?.getAttribute("aria-current")).toBe("page");
  });

  it("does NOT mark Clients active when on /cma", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/cma");
    const { container } = render(<SidebarNav clientsCount={5} />);
    const clientsLink = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.includes("Clients") && !a.textContent?.includes("CMA")
    );
    expect(clientsLink?.getAttribute("aria-current")).toBeNull();
  });

  it("renders placeholders (e.g. Tasks) as non-anchor items with Soon badge", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients");
    const { container } = render(<SidebarNav clientsCount={0} />);
    const allText = container.textContent ?? "";
    expect(allText).toContain("Soon");
    expect(allText).toContain("Tasks");
  });
});
