// @vitest-environment jsdom
// src/components/fact-finder/__tests__/closed-view.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ClosedView } from "../closed-view";
import type { FFClosed } from "@/lib/fact-finder/types";

const CLOSED: FFClosed = {
  at: "2026-10-14T12:00:00.000Z",
  by: "user_1",
  saved: [
    { lineId: "c1/account", rowId: "c1", target: "account", recordId: "acct-9", label: "Joint Checking" },
    { lineId: "w1/will", rowId: "w1", target: "will", recordId: "will-1", label: "Mark's will" },
  ],
  leftOut: [
    { lineId: "m1/liability", rowId: "m1", label: "Mortgage", reason: "Needs “Lake House”, which isn't being saved." },
    { lineId: "x1/account", rowId: "x1", label: "Old IRA", reason: "Needs Name." },
  ],
};

describe("ClosedView", () => {
  it("says when the import was saved and how many lines went in and stayed out", () => {
    render(<ClosedView clientId="c1" closed={CLOSED} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved to the plan on October 14, 2026 — 2 saved, 2 left out");
  });

  it("links each saved line to the Details page that shows it", () => {
    render(<ClosedView clientId="c1" closed={CLOSED} />);
    const saved = screen.getByRole("list", { name: "Saved to the plan" });
    expect(within(saved).getByRole("link", { name: "Joint Checking" })).toHaveAttribute("href", "/clients/c1/details/net-worth");
    expect(within(saved).getByRole("link", { name: "Mark's will" })).toHaveAttribute("href", "/clients/c1/details/wills");
  });

  it("lists what was left out with the reason beside each", () => {
    render(<ClosedView clientId="c1" closed={CLOSED} />);
    const left = screen.getByRole("list", { name: "Left out" });
    const items = within(left).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Mortgage");
    expect(items[0]).toHaveTextContent("Needs “Lake House”, which isn't being saved.");
    expect(within(left).queryByRole("link")).toBeNull();
  });

  it("brings the summary into view and gives it focus when the save just landed — not when a saved import is opened", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { unmount } = render(<ClosedView clientId="c1" closed={CLOSED} />);
      expect(screen.getByRole("status")).not.toHaveFocus();
      expect(scrollIntoView).not.toHaveBeenCalled();
      unmount();
      render(<ClosedView clientId="c1" closed={CLOSED} justSaved />);
      expect(screen.getByRole("status")).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "center" });
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("status"));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("uses singular words for one and shows no left-out list when nothing was left out", () => {
    render(<ClosedView clientId="c1" closed={{ ...CLOSED, saved: CLOSED.saved.slice(0, 1), leftOut: [] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 saved, 0 left out");
    expect(screen.queryByRole("list", { name: "Left out" })).toBeNull();
  });
});
