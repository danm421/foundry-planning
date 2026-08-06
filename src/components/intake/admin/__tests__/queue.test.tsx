// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Queue, { type QueueGroup } from "../queue";
import type { IntakeFormRow } from "@/lib/intake/queries";

function makeForm(overrides: Partial<IntakeFormRow> = {}): IntakeFormRow {
  return {
    id: "form-1",
    firmId: "firm-1",
    clientId: null,
    mode: "blank",
    status: "draft",
    token: "tok-abc",
    recipientEmail: "alice@example.com",
    recipientName: "Alice",
    payload: {} as IntakeFormRow["payload"],
    createdByUserId: "user-1",
    sentAt: null,
    openedAt: null,
    submittedAt: null,
    appliedAt: null,
    expiresAt: new Date("2026-12-31"),
    createdAt: new Date("2026-06-01"),
    updatedAt: new Date("2026-06-01"),
    ...overrides,
  };
}

const submittedForm = makeForm({ id: "f-submitted", status: "submitted", recipientName: "Bob" });
const draftForm = makeForm({ id: "f-draft", status: "draft", recipientName: "Carol" });
const appliedForm = makeForm({ id: "f-applied", status: "applied", recipientName: "Dave" });
const discardedForm = makeForm({ id: "f-discarded", status: "discarded", recipientName: "Eve" });

// Mirrors the buckets src/app/(app)/data-collection/page.tsx builds, including
// their date columns — the point of the column set is that it varies per tab.
const groups: QueueGroup[] = [
  { label: "In flight", forms: [draftForm], dateColumns: ["sent", "accessed"] },
  { label: "Needs review", forms: [submittedForm], dateColumns: ["sent", "accessed", "completed"] },
  { label: "History", forms: [appliedForm, discardedForm], dateColumns: ["closed"] },
];

/** The panel a tab controls, found through its aria-controls wiring. */
function panelFor(tabName: RegExp) {
  const tab = screen.getByRole("tab", { name: tabName });
  const panel = document.getElementById(tab.getAttribute("aria-controls")!);
  if (!panel) throw new Error(`no panel for ${tabName}`);
  return panel;
}

describe("Queue", () => {
  it("renders one tab per group", () => {
    render(<Queue groups={groups} />);
    expect(screen.getByRole("tab", { name: /in flight/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /needs review/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /history/i })).toBeInTheDocument();
  });

  it("counts the forms in each tab", () => {
    render(<Queue groups={groups} />);
    expect(screen.getByRole("tab", { name: /in flight/i })).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: /history/i })).toHaveTextContent("2");
  });

  it("opens on the first non-empty tab", () => {
    render(<Queue groups={groups} />);
    expect(screen.getByRole("tab", { name: /in flight/i })).toHaveAttribute("aria-selected", "true");
  });

  it("skips leading empty tabs so work is never one tab out of sight", () => {
    render(
      <Queue
        groups={[
          { label: "In flight", forms: [], dateColumns: ["sent", "accessed"] },
          { label: "Needs review", forms: [submittedForm], dateColumns: ["sent"] },
          { label: "History", forms: [], dateColumns: ["closed"] },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: /needs review/i })).toHaveAttribute("aria-selected", "true");
  });

  it("shows only the active tab's panel", () => {
    render(<Queue groups={groups} />);
    expect(panelFor(/in flight/i)).not.toHaveAttribute("hidden");
    expect(panelFor(/needs review/i)).toHaveAttribute("hidden");
    expect(panelFor(/history/i)).toHaveAttribute("hidden");
  });

  it("switches panels on click", () => {
    render(<Queue groups={groups} />);
    fireEvent.click(screen.getByRole("tab", { name: /needs review/i }));
    expect(panelFor(/needs review/i)).not.toHaveAttribute("hidden");
    expect(panelFor(/in flight/i)).toHaveAttribute("hidden");
  });

  it("moves between tabs with the arrow keys", () => {
    render(<Queue groups={groups} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /in flight/i }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /needs review/i })).toHaveAttribute("aria-selected", "true");
  });

  it("files each form under its own bucket's panel", () => {
    render(<Queue groups={groups} />);
    expect(within(panelFor(/in flight/i)).getByText("Carol")).toBeInTheDocument();
    expect(within(panelFor(/needs review/i)).getByText("Bob")).toBeInTheDocument();
    expect(within(panelFor(/history/i)).getByText("Dave")).toBeInTheDocument();
    expect(within(panelFor(/history/i)).getByText("Eve")).toBeInTheDocument();
  });

  it("each row links to the detail route", () => {
    const { container } = render(<Queue groups={groups} />);
    // Query the DOM, not the a11y tree: the inactive panels carry `hidden`, so
    // getAllByRole("link") would only ever see the open tab's rows.
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/data-collection/f-submitted");
    expect(hrefs).toContain("/data-collection/f-draft");
    expect(hrefs).toContain("/data-collection/f-applied");
  });

  it("labels a form by its recipient, not its mode", () => {
    // A blank form bound to a client is an existing-client send: its answers
    // merge onto that client, so it must not read as a prospect.
    render(
      <Queue
        groups={[
          {
            label: "In flight",
            forms: [
              makeForm({ id: "f-prospect", mode: "blank", clientId: null, recipientName: "Pat" }),
              makeForm({ id: "f-client", mode: "blank", clientId: "client-1", recipientName: "Quinn" }),
            ],
            dateColumns: ["sent"],
          },
        ]}
      />,
    );
    expect(screen.getByText("Prospect")).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
  });

  it("states the status in words, not colour alone", () => {
    render(<Queue groups={groups} />);
    expect(within(panelFor(/history/i)).getByText("Applied")).toBeInTheDocument();
    expect(within(panelFor(/history/i)).getByText("Discarded")).toBeInTheDocument();
  });

  it("renders each empty bucket's own message", () => {
    render(
      <Queue
        groups={[
          {
            label: "In flight",
            forms: [],
            dateColumns: ["sent", "accessed"],
            empty: "No forms are out with a client right now.",
          },
          { label: "Needs review", forms: [], dateColumns: ["sent"], empty: "Nothing to review." },
        ]}
      />,
    );
    expect(within(panelFor(/in flight/i)).getByText(/out with a client/i)).toBeInTheDocument();
  });

  it("gives each bucket its own date columns", () => {
    render(<Queue groups={groups} />);
    const inFlight = within(panelFor(/in flight/i));
    const needsReview = within(panelFor(/needs review/i));

    // In flight chases a reply: sent, and whether they've looked.
    expect(inFlight.getByText("Sent")).toBeInTheDocument();
    expect(inFlight.getByText("Accessed")).toBeInTheDocument();
    expect(inFlight.queryByText("Completed")).not.toBeInTheDocument();

    // Needs review adds the round-trip close.
    expect(needsReview.getByText("Sent")).toBeInTheDocument();
    expect(needsReview.getByText("Accessed")).toBeInTheDocument();
    expect(needsReview.getByText("Completed")).toBeInTheDocument();

    // History keeps its single, status-aware date.
    const history = within(panelFor(/history/i));
    expect(history.getByText("Closed")).toBeInTheDocument();
    expect(history.queryByText("Sent")).not.toBeInTheDocument();
  });

  it("reads each column off its own timestamp", () => {
    render(
      <Queue
        groups={[
          {
            label: "Needs review",
            forms: [
              makeForm({
                id: "f-dates",
                status: "submitted",
                recipientName: "Rae",
                sentAt: new Date("2026-03-02T12:00:00Z"),
                openedAt: new Date("2026-04-03T12:00:00Z"),
                submittedAt: new Date("2026-05-04T12:00:00Z"),
              }),
            ],
            dateColumns: ["sent", "accessed", "completed"],
          },
        ]}
      />,
    );
    // Three distinct months, so a column reading the wrong timestamp shows up
    // as the wrong month rather than passing on a shared value. Asserted as
    // label+value together — each cell carries its own screen-reader label, so
    // this also pins the date to the column it belongs to.
    const row = screen.getByRole("link");
    expect(row).toHaveTextContent("Sent: Mar 2, 2026");
    expect(row).toHaveTextContent("Accessed: Apr 3, 2026");
    expect(row).toHaveTextContent("Completed: May 4, 2026");
  });

  it("shows an em-dash for a form the recipient has never opened", () => {
    render(
      <Queue
        groups={[
          {
            label: "In flight",
            forms: [
              // Midday UTC so the assertion can't flip a day under the runner's
              // local zone — `formatDate` renders in local time.
              makeForm({
                id: "f-unopened",
                openedAt: null,
                sentAt: new Date("2026-06-01T12:00:00Z"),
              }),
            ],
            dateColumns: ["sent", "accessed"],
          },
        ]}
      />,
    );
    // "Accessed" has no createdAt fallback: an em-dash is the honest answer,
    // and a fallback would read as "they opened it the day it was created".
    const row = screen.getByRole("link");
    expect(row).toHaveTextContent("Accessed: not yet");
    // Sent still resolves — only the columns with no fallback go blank.
    expect(row).toHaveTextContent("Sent: Jun 1, 2026");
  });

  it("dates a History row from the timestamp its end state actually ended on", () => {
    render(
      <Queue
        groups={[
          {
            label: "History",
            forms: [
              makeForm({
                id: "f-applied",
                status: "applied",
                recipientName: "Sam",
                submittedAt: new Date("2026-05-04T12:00:00Z"),
                appliedAt: new Date("2026-06-05T12:00:00Z"),
                updatedAt: new Date("2026-07-06T12:00:00Z"),
              }),
              makeForm({
                id: "f-discarded",
                status: "discarded",
                recipientName: "Tal",
                appliedAt: null,
                updatedAt: new Date("2026-08-07T12:00:00Z"),
              }),
            ],
            dateColumns: ["closed"],
          },
        ]}
      />,
    );
    // appliedAt wins over the later updatedAt; a discarded form has no
    // appliedAt, so it falls to updatedAt.
    const [applied, discarded] = screen.getAllByRole("link");
    expect(applied).toHaveTextContent("Closed: Jun 5, 2026");
    expect(discarded).toHaveTextContent("Closed: Aug 7, 2026");
  });
});
