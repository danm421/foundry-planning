// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FeedIcon } from "../feed-icon";
import type { FeedItemKind } from "@/lib/home/types";

const KINDS: FeedItemKind[] = [
  "task-due",
  "birthday",
  "milestone",
  "mention",
  "intake-submitted",
  "import-committed",
];

describe("FeedIcon", () => {
  it("renders a decorative svg for every feed kind", () => {
    for (const kind of KINDS) {
      const { container } = render(<FeedIcon kind={kind} />);
      const svg = container.querySelector("svg")!;
      expect(svg, `no svg for ${kind}`).toBeTruthy();
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("gives each kind a distinct data-palette hue", () => {
    const hues = KINDS.map((kind) => {
      const { container } = render(<FeedIcon kind={kind} />);
      return container.querySelector("svg")!.getAttribute("class");
    });
    expect(new Set(hues).size).toBe(KINDS.length);
  });

  it("never uses data-teal (reads as the accent)", () => {
    for (const kind of KINDS) {
      const { container } = render(<FeedIcon kind={kind} />);
      expect(container.querySelector("svg")!.getAttribute("class")).not.toContain("data-teal");
    }
  });

  it("turns an overdue task red", () => {
    const { container } = render(<FeedIcon kind="task-due" overdue />);
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("text-data-red");
  });
});
