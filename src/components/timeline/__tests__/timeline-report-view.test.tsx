// @vitest-environment jsdom
// src/components/timeline/__tests__/timeline-report-view.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildClientData } from "@/engine/__tests__/fixtures";
import TimelineReportView from "@/components/timeline-report-view";

beforeEach(() => {
  const data = buildClientData();
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => data,
  })) as unknown as typeof fetch;
  // IntersectionObserver + ResizeObserver are not in jsdom — stub them.
  class RO { observe() {} unobserve() {} disconnect() {} }
  class IO { constructor(_cb: unknown) {} observe() {} unobserve() {} disconnect() {} takeRecords(): IntersectionObserverEntry[] { return []; } }
  global.ResizeObserver = RO;
  // @ts-expect-error test stub
  global.IntersectionObserver = IO;
});

describe("TimelineReportView", () => {
  it("renders loading state then the timeline header", async () => {
    render(<TimelineReportView clientId="client-1" />);
    expect(await screen.findByText(/Timeline/i)).toBeDefined();
  });

  it("hides category events when the chip is toggled off", async () => {
    const user = userEvent.setup();
    render(<TimelineReportView clientId="client-1" />);
    const incomeChip = await screen.findByRole("button", { name: "Income" });
    // Before toggle: expect at least one "begins" event rendered (salary start).
    expect((await screen.findAllByText(/begins/i)).length).toBeGreaterThan(0);
    await user.click(incomeChip);
    // After toggle: income events hidden. Some "begins" events may still come from Life (SS claim) —
    // this assertion verifies the income-origin events reduce in count.
    const remaining = screen.queryAllByText(/Salary begins|salary ends/i);
    expect(remaining.length).toBe(0);
  });

  it("expands a card on click and collapses on Escape", async () => {
    const user = userEvent.setup();
    render(<TimelineReportView clientId="client-1" />);
    const firstCard = (await screen.findAllByRole("button", { expanded: false }))[0];
    await user.click(firstCard);
    // At least one expanded card should now exist.
    expect(screen.getAllByRole("button", { expanded: true }).length).toBeGreaterThan(0);
    await user.keyboard("{Escape}");
    expect(screen.queryAllByRole("button", { expanded: true }).length).toBe(0);
  });
});
