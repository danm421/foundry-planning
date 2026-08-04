// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxList from "../inbox-list";
import type { InboxRow } from "@/lib/notifications/queries";

vi.mock("@/app/(app)/alerts/actions", () => ({
  markReadAction: vi.fn(),
  markAllReadAction: vi.fn(),
}));

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: "n-1",
  category: "intake_submitted",
  title: "The Johnsons submitted their intake form",
  body: null,
  url: "/data-collection/form-1",
  readAt: null,
  createdAt: new Date("2026-08-03T12:00:00.000Z"),
  ...over,
});

describe("InboxList", () => {
  it("links each row to its deep link", () => {
    render(<InboxList rows={[row()]} filtered={false} />);
    expect(
      screen.getByRole("link", { name: /Johnsons submitted/i }),
    ).toHaveAttribute("href", "/data-collection/form-1");
  });

  it("marks the unread row and gives each row its own deep link", () => {
    render(
      <InboxList
        rows={[
          row({ id: "a", title: "Still unread", url: "/alerts/a" }),
          row({ id: "b", title: "Already read", url: "/alerts/b", readAt: new Date() }),
        ]}
        filtered={false}
      />,
    );
    const unreadRow = screen.getByRole("link", { name: /Still unread/ });
    const readRow = screen.getByRole("link", { name: /Already read/ });

    const dots = screen.getAllByTestId("unread-dot");
    expect(dots).toHaveLength(1);
    // The count alone does not discriminate: with one read and one unread row,
    // inverting the read/unread branch still renders exactly one dot. Bind the
    // dot to the row it belongs to so a swapped branch reddens.
    expect(unreadRow).toContainElement(dots[0]);

    // Both urls differ so an href hoisted out of the .map — every row pointing
    // at rows[0] — reddens here. A single-row fixture cannot catch that.
    expect(unreadRow).toHaveAttribute("href", "/alerts/a");
    expect(readRow).toHaveAttribute("href", "/alerts/b");
  });

  it("renders an empty state rather than a bare blank panel", () => {
    render(<InboxList rows={[]} filtered={false} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  // An empty list under a filter is not an empty book. Telling an advisor whose
  // alerts are merely all read that "nothing lands here yet" is a lie, so the
  // filtered copy must replace it — not sit alongside it.
  it("blames the filter, not the book, when a filter narrowed the list", () => {
    render(<InboxList rows={[]} filtered />);
    expect(screen.getByText(/nothing matches this filter/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /show all alerts/i })).toHaveAttribute(
      "href",
      "/alerts",
    );
  });

  it("shows the body line when present", () => {
    render(<InboxList rows={[row({ body: "3 documents attached" })]} filtered={false} />);
    expect(screen.getByText("3 documents attached")).toBeInTheDocument();
  });
});
