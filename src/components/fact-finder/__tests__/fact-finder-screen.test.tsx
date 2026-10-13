// @vitest-environment jsdom
// src/components/fact-finder/__tests__/fact-finder-screen.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FactFinderScreen } from "../fact-finder-screen";
import type { FFScreenFile } from "../screen-types";
import { sectionsOnPage } from "@/lib/fact-finder/schema";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFCell, FFFileReading, FFRow } from "@/lib/fact-finder/types";

const lowConfidence = (value: string): FFCell => ({ value, confidence: 0.5, by: "document", source: { fileId: "f1" } });
const suggested = (recordId: string): FFRow["link"] => ({ kind: "existing", recordId, score: 0.74, confirmed: false, by: "auto" });
const cashRow = (id: string, recordId: string): FFRow => ({
  id,
  cells: { accountName: lowConfidence("Joint Checking") },
  link: suggested(recordId),
  sourceFileIds: ["f1"],
});

/** f1 has been read, so the screen doesn't start a read as it opens. */
const READ: FFFileReading = { status: "done", startedAt: "2026-10-13T09:00:00.000Z", rows: 1 };

/** Mark typed in by hand on Household; one cash account to check, with a link that needs a click. */
function filled(): FactFinderState {
  const s = emptyFactFinderState();
  const [client, coClient] = s.sections.people;
  return {
    ...s,
    readings: { f1: READ },
    sections: {
      ...s.sections,
      people: [{ ...client, cells: { firstName: { value: "Mark", by: "advisor", pinned: true } } }, coClient],
      cash: [cashRow("c1", "acct-1")],
    },
  };
}
const twoLinks = (): FactFinderState => {
  const s = filled();
  return { ...s, sections: { ...s.sections, cash: [cashRow("c1", "acct-1"), cashRow("c2", "acct-2")] } };
};
const reading = (): FactFinderState => ({
  ...filled(),
  readings: { f1: { status: "reading", startedAt: new Date().toISOString() } },
});

const FILES: FFScreenFile[] = [{ id: "f1", name: "hendricks-fact-finder.pdf", documentType: "auto" }];

function renderScreen(state: FactFinderState = filled()) {
  return render(
    <FactFinderScreen clientId="c1" importId="i1" initialState={state} initialFiles={FILES} entities={[]} />,
  );
}

/** Narrow = the screen is below 1100 px, as `(max-width: 1099px)` reports it. */
function stubScreenWidth(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow && query === "(max-width: 1099px)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("page rail", () => {
  it("lists the seven pages in order, with a dot for pages with values and their counts", () => {
    renderScreen(twoLinks());
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    const pages = within(rail).getAllByRole("button");
    expect(pages).toHaveLength(7);
    [
      "Household, has values",
      "Accounts, has values, 2 values to check, 2 links to confirm",
      "Real estate & debts",
      "Income",
      "Expenses & savings",
      "Insurance",
      "Estate",
    ].forEach((name, i) => expect(pages[i]).toHaveAccessibleName(name));
  });

  it("marks the selected page and switches the main area to the page clicked", async () => {
    renderScreen();
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    expect(within(rail).getByRole("button", { name: /^Household/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: "Household" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Client & Co-client" })).toBeInTheDocument();

    await userEvent.click(within(rail).getByRole("button", { name: /^Accounts/ }));

    expect(within(rail).getByRole("button", { name: /^Accounts/ })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("button", { name: /^Household/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { level: 2, name: "Accounts" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(
      sectionsOnPage("accounts").map((s) => s.label),
    );
    expect(screen.queryByRole("heading", { name: "Client & Co-client" })).toBeNull();
  });

  it("shows the selected page's sections as tables, naming each value's source from the uploaded files", async () => {
    renderScreen();
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    await userEvent.click(within(rail).getByRole("button", { name: /^Accounts/ }));
    const cash = screen.getByRole("table", { name: "Cash Accounts" });
    expect(within(cash).getByRole("textbox", { name: "Account name" })).toHaveValue("Joint Checking");
    expect(within(cash).getByRole("tooltip")).toHaveTextContent("From hendricks-fact-finder.pdf");
  });
});

describe("Review changes", () => {
  it.each([
    ["a document is still reading", reading(), "Wait for the documents to finish reading."],
    ["two links need a click", twoLinks(), "2 links need a click first."],
    ["one link needs a click", filled(), "1 link needs a click first."],
    ["nothing blocks it", { ...emptyFactFinderState(), readings: { f1: READ } }, "Review arrives in the next update."],
  ])("stays disabled when %s, and says why", (_case, state, reason) => {
    renderScreen(state);
    const review = screen.getByRole("button", { name: "Review changes →" });
    expect(review).toBeDisabled();
    expect(review).toHaveAccessibleDescription(reason);
  });

  it("links back to the imports list", () => {
    renderScreen();
    expect(screen.getByRole("link", { name: "← Back to imports" })).toHaveAttribute("href", "/clients/c1/details/import");
    expect(screen.getByRole("heading", { level: 1, name: "Fact finder import" })).toBeInTheDocument();
  });

  it("says in the header that changes save automatically", () => {
    renderScreen();
    expect(within(screen.getByRole("banner")).getByText("Changes save automatically")).toBeInTheDocument();
  });
});

describe("side panel", () => {
  it("starts closed when nothing is reading; the header button shows it and its close button hides it", async () => {
    renderScreen();
    const toggle = screen.getByRole("button", { name: "Documents & chat" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "Documents & chat" })).toBeNull();

    await userEvent.click(toggle);
    const panel = screen.getByRole("complementary", { name: "Documents & chat" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const lines = within(panel).getByRole("list", { name: "Reading progress" });
    expect(within(lines).getByText("hendricks-fact-finder.pdf")).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: "Hide documents & chat" }));
    expect(screen.queryByRole("complementary", { name: "Documents & chat" })).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("starts open while a document is reading", () => {
    renderScreen(reading());
    expect(screen.getByRole("complementary", { name: "Documents & chat" })).toBeInTheDocument();
  });

  it("is an overlay drawer below 1100 px: it takes focus, locks the page scroll, and Escape closes it", async () => {
    stubScreenWidth(true);
    renderScreen();
    const toggle = screen.getByRole("button", { name: "Documents & chat" });
    await userEvent.click(toggle);

    const drawer = screen.getByRole("dialog", { name: "Documents & chat" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.queryByRole("complementary")).toBeNull();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(toggle).toHaveFocus();
  });

  it("stays beside the page at 1100 px and wider", async () => {
    stubScreenWidth(false);
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Documents & chat" }));
    expect(screen.getByRole("complementary", { name: "Documents & chat" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
