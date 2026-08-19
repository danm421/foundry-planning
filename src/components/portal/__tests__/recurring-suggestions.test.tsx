// @vitest-environment jsdom
import { it, expect, vi, beforeEach, describe } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/portal/portal-mode-context", () => ({ usePortalFetch: () => vi.fn() }));

import RecurringsView from "@/components/portal/recurrings-view";
import type { RecurringsData } from "@/lib/portal/recurring-matching";
import type { RecurringSuggestionDTO } from "@/lib/portal/contracts";

const spotify: RecurringSuggestionDTO = {
  key: "monthly:spotify:11",
  name: "Spotify",
  matchType: "contains",
  pattern: "Spotify",
  amountMin: 8.79,
  amountMax: 13.74,
  predicted: 10.99,
  cadence: "monthly",
  dueDay: 22,
  dueMonth: null,
  occurrences: 7,
  lastDate: "2026-06-22",
  categoryId: "c-subs",
  categoryName: "Subscriptions",
  categoryColor: "var(--data-purple)",
  categoryIcon: "🎧",
  sample: [{ id: "t1", date: "2026-06-22", amount: 10.99 }],
};

const data: RecurringsData = {
  month: "2026-06",
  paidSoFar: 0,
  leftToPay: 0,
  recurrings: [],
  suggestions: [spotify],
};

function view(over: Partial<RecurringsData> = {}, editEnabled = true) {
  return render(
    <RecurringsView
      data={{ ...data, ...over }}
      categories={[{ id: "c-subs", name: "Subscriptions", kind: "category", parentId: null }]}
      editEnabled={editEnabled}
      clientId="client-1"
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("suggested recurrings", () => {
  it("shows what was found: the name, how often, how many charges, and the amount", () => {
    view();
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Spotify")).toBeInTheDocument();
    expect(within(row).getByText(/Monthly/)).toBeInTheDocument();
    expect(within(row).getByText("7")).toBeInTheDocument();
    expect(within(row).getByText("$11")).toBeInTheDocument();
    expect(within(row).getByText("Jun 22")).toBeInTheDocument();
  });

  it("opens a NEW recurring prefilled from the suggestion — not an edit of something", async () => {
    // The whole value of a suggestion is the prefill. A dialog that opens blank
    // would look identical in a smoke test and be worthless to the client.
    view();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("New recurring transaction")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name$/)).toHaveValue("Spotify");
    expect(screen.getByLabelText(/Match pattern/i)).toHaveValue("Spotify");
    expect(screen.getByLabelText(/Min amount/i)).toHaveValue("8.79");
    expect(screen.getByLabelText(/Max amount/i)).toHaveValue("13.74");
    expect(screen.getByLabelText(/How often/i)).toHaveValue("monthly");
    expect(screen.getByLabelText(/Anytime in the month/i)).not.toBeChecked();
    expect(screen.getByLabelText(/Due day/i)).toHaveValue("22");
  });

  it("dismisses a suggestion and keeps it gone on the next visit", async () => {
    const { unmount } = view();
    await userEvent.click(screen.getByRole("button", { name: /Dismiss Spotify/i }));
    expect(screen.queryByText("Spotify")).not.toBeInTheDocument();

    unmount();
    view();
    expect(screen.queryByText("Spotify")).not.toBeInTheDocument();
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("says nothing at all when there is nothing to suggest", () => {
    view({ suggestions: [] });
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("stays quiet in a read-only portal, where the client could not act on it", () => {
    view({}, false);
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });
});
