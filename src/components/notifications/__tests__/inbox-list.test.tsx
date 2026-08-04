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
    render(<InboxList rows={[row()]} />);
    expect(
      screen.getByRole("link", { name: /Johnsons submitted/i }),
    ).toHaveAttribute("href", "/data-collection/form-1");
  });

  it("marks unread rows visually", () => {
    render(
      <InboxList
        rows={[
          row({ id: "a", title: "Still unread" }),
          row({ id: "b", title: "Already read", readAt: new Date() }),
        ]}
      />,
    );
    const dots = screen.getAllByTestId("unread-dot");
    expect(dots).toHaveLength(1);
    // The count alone does not discriminate: with one read and one unread row,
    // inverting the read/unread branch still renders exactly one dot. Bind the
    // dot to the row it belongs to so a swapped branch reddens.
    expect(screen.getByRole("link", { name: /Still unread/ })).toContainElement(
      dots[0],
    );
  });

  it("renders an empty state rather than a bare blank panel", () => {
    render(<InboxList rows={[]} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it("shows the body line when present", () => {
    render(<InboxList rows={[row({ body: "3 documents attached" })]} />);
    expect(screen.getByText("3 documents attached")).toBeInTheDocument();
  });
});
