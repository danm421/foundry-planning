// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SidebarNavItem from "../sidebar-nav-item";

function DummyIcon() {
  return <svg data-testid="icon" />;
}

describe("SidebarNavItem", () => {
  describe("link variant", () => {
    it("renders an anchor with the href when not a placeholder", () => {
      const { container } = render(
        <SidebarNavItem icon={<DummyIcon />} label="Clients" href="/clients" active={false} />
      );
      const link = container.querySelector("a");
      expect(link).not.toBeNull();
      expect(link?.getAttribute("href")).toBe("/clients");
      expect(container.textContent).toContain("Clients");
    });

    it("renders count when provided", () => {
      const { container } = render(
        <SidebarNavItem icon={<DummyIcon />} label="Clients" href="/clients" count={28} active={false} />
      );
      expect(container.textContent).toContain("28");
    });

    it("applies active surface + accent bar + aria-current when active", () => {
      const { container } = render(
        <SidebarNavItem icon={<DummyIcon />} label="Clients" href="/clients" active />
      );
      const link = container.querySelector("a");
      expect(link?.className).toContain("bg-card");
      expect(link?.getAttribute("aria-current")).toBe("page");
      const bar = container.querySelector('[data-testid="active-bar"]');
      expect(bar).not.toBeNull();
    });

    it("does not render the active bar when inactive", () => {
      const { container } = render(
        <SidebarNavItem icon={<DummyIcon />} label="Clients" href="/clients" active={false} />
      );
      expect(container.querySelector('[data-testid="active-bar"]')).toBeNull();
    });
  });

  describe("placeholder variant", () => {
    it("renders a div, not an anchor, when placeholder", () => {
      const { container } = render(
        <SidebarNavItem icon={<DummyIcon />} label="Tasks" placeholder active={false} />
      );
      expect(container.querySelector("a")).toBeNull();
      const div = container.firstChild as HTMLElement;
      expect(div.tagName).toBe("DIV");
    });

    it("shows a Soon badge for placeholders", () => {
      const { container } = render(
        <SidebarNavItem icon={<DummyIcon />} label="Tasks" placeholder active={false} />
      );
      expect(container.textContent).toContain("Soon");
    });

    it("omits count on placeholders even if one is passed", () => {
      const { container } = render(
        <SidebarNavItem icon={<DummyIcon />} label="Tasks" placeholder count={99} active={false} />
      );
      expect(container.textContent).not.toContain("99");
    });

    it("never renders active state on placeholders", () => {
      const { container } = render(
        <SidebarNavItem icon={<DummyIcon />} label="Tasks" placeholder active />
      );
      expect(container.querySelector('[data-testid="active-bar"]')).toBeNull();
    });
  });
});
