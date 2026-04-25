// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DialogTabs from "../dialog-tabs";

describe("DialogTabs", () => {
  const tabs = [
    { id: "details", label: "Details" },
    { id: "savings", label: "Savings" },
  ];

  it("renders one button per tab", () => {
    render(<DialogTabs tabs={tabs} activeTab="details" onTabChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Details" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Savings" })).toBeDefined();
  });

  it("uses uppercase styling and tracking on each tab label", () => {
    render(<DialogTabs tabs={tabs} activeTab="details" onTabChange={() => {}} />);
    const btn = screen.getByRole("button", { name: "Details" });
    expect(btn.className).toContain("uppercase");
    expect(btn.className).toContain("tracking-");
  });

  it("applies the accent underline to the active tab only", () => {
    render(<DialogTabs tabs={tabs} activeTab="details" onTabChange={() => {}} />);
    const active = screen.getByRole("button", { name: "Details" });
    const inactive = screen.getByRole("button", { name: "Savings" });
    expect(active.className).toContain("text-accent-ink");
    expect(active.className).toContain("border-accent");
    expect(inactive.className).toContain("text-ink-3");
    expect(inactive.className).not.toContain("border-accent");
  });

  it("calls onTabChange with the tab id when an inactive tab is clicked", () => {
    const onTabChange = vi.fn();
    render(<DialogTabs tabs={tabs} activeTab="details" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Savings" }));
    expect(onTabChange).toHaveBeenCalledWith("savings");
  });
});
