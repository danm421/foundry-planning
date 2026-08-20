// @vitest-environment jsdom
import { it, expect, vi, beforeEach, describe } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetchMock,
}));

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

/** The deeper pass the "Search for more" button runs. Returned as-is by the
 *  suggestions endpoint. */
function respond(suggestions: RecurringSuggestionDTO[]): void {
  portalFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ suggestions }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  portalFetchMock.mockReset();
  respond([]);
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
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("offers the search even with nothing to suggest — that client wants it most", () => {
    view({ suggestions: [] });
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search for more" })).toBeInTheDocument();
  });

  it("stays quiet in a read-only portal, where the client could not act on it", () => {
    view({}, false);
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search for more" })).not.toBeInTheDocument();
  });
});

const calm: RecurringSuggestionDTO = {
  ...spotify,
  key: "monthly:calm:15",
  name: "Calm",
  pattern: "Calm",
  predicted: 14.99,
  occurrences: 2,
  categoryIcon: "🧘",
};

describe("searching for more recurrings", () => {
  it("asks the server for the wide pass and shows what came back", async () => {
    respond([spotify, calm]);
    view();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Search for more" }));

    expect(portalFetchMock).toHaveBeenCalledWith("/api/portal/recurrings/suggestions?scope=wide");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // The list the client was already reading keeps its place at the top; the
    // wide pass repeats it, and a repeat must not become a duplicate row.
    expect(within(rows[0]).getByText("Spotify")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Calm")).toBeInTheDocument();
  });

  it("says so when the deeper search turns nothing up, and stops offering it", async () => {
    respond([spotify]);
    view();
    await userEvent.click(screen.getByRole("button", { name: "Search for more" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/everything we could find/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search for more" })).not.toBeInTheDocument();
  });

  it("tells a client with no suggestions at all that their history has none", async () => {
    respond([]);
    view({ suggestions: [] });
    await userEvent.click(screen.getByRole("button", { name: "Search for more" }));

    expect(screen.getByText(/did.?n.?t find any repeating charges/i)).toBeInTheDocument();
  });

  it("keeps a dismissed suggestion dismissed when the wide pass returns it again", async () => {
    respond([spotify, calm]);
    view();
    await userEvent.click(screen.getByRole("button", { name: /Dismiss Spotify/i }));
    await userEvent.click(screen.getByRole("button", { name: "Search for more" }));

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Calm")).toBeInTheDocument();
  });

  it("a failed search leaves the button offered rather than claiming nothing exists", async () => {
    portalFetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    view();
    await userEvent.click(screen.getByRole("button", { name: "Search for more" }));

    expect(screen.queryByText(/everything we could find/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search for more" })).toBeEnabled();
  });
});
