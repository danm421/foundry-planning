import { describe, expect, it } from "vitest";
import { assembleFeed, GROUP_CAP } from "../feed-assemble";
import type { FeedItem } from "../types";

const NOW = new Date(2026, 6, 16); // 2026-07-16

function item(over: Partial<FeedItem>): FeedItem {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    kind: "task-due",
    title: "t",
    subtitle: null,
    href: "/tasks",
    when: NOW,
    ...over,
  };
}

describe("assembleFeed", () => {
  it("routes coming-up kinds and recent kinds to their groups", () => {
    const feed = assembleFeed(
      [
        item({ id: "a", kind: "task-due" }),
        item({ id: "b", kind: "birthday" }),
        item({ id: "c", kind: "milestone" }),
        item({ id: "d", kind: "mention" }),
        item({ id: "e", kind: "intake-submitted" }),
        item({ id: "f", kind: "import-committed" }),
      ],
    );
    expect(feed.comingUp.map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
    expect(feed.recent.map((i) => i.id).sort()).toEqual(["d", "e", "f"]);
  });

  it("sorts coming-up ascending by when (overdue first naturally)", () => {
    const feed = assembleFeed(
      [
        item({ id: "later", when: new Date(2026, 6, 20) }),
        item({ id: "overdue", when: new Date(2026, 6, 10), overdue: true }),
        item({ id: "soon", when: new Date(2026, 6, 17) }),
      ],
    );
    expect(feed.comingUp.map((i) => i.id)).toEqual(["overdue", "soon", "later"]);
  });

  it("sorts recent descending by when", () => {
    const feed = assembleFeed(
      [
        item({ id: "old", kind: "mention", when: new Date(2026, 6, 2) }),
        item({ id: "new", kind: "mention", when: new Date(2026, 6, 15) }),
      ],
    );
    expect(feed.recent.map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("caps each group at GROUP_CAP", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      item({ id: `t${i}`, when: new Date(2026, 6, 17) }),
    );
    const feed = assembleFeed(many);
    expect(feed.comingUp).toHaveLength(GROUP_CAP);
  });

  it("ties in coming-up break deterministically by id", () => {
    const feed = assembleFeed(
      [item({ id: "b", when: NOW }), item({ id: "a", when: NOW })],
    );
    expect(feed.comingUp.map((i) => i.id)).toEqual(["a", "b"]);
  });
});
