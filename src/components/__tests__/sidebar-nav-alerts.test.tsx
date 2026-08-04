// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SidebarNav from "../sidebar-nav";
import { SidebarProvider } from "../sidebar-provider";

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));

function renderNav(unreadCount: number) {
  return render(
    <SidebarProvider initialCollapsed={false}>
      <SidebarNav clientsCount={3} unreadCount={unreadCount} />
    </SidebarProvider>,
  );
}

describe("sidebar Alerts entry", () => {
  it("renders an Alerts link to /alerts", () => {
    renderNav(0);
    const link = screen.getByRole("link", { name: /alerts/i });
    expect(link).toHaveAttribute("href", "/alerts");
  });

  it("shows the unread count when there is one", () => {
    renderNav(7);
    expect(screen.getByRole("link", { name: /alerts/i })).toHaveTextContent("7");
  });

  // A "0" badge is visual noise that trains people to ignore the badge.
  it("shows no badge at zero unread", () => {
    renderNav(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
