// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Queue from "../queue";
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

const groups = [
  { label: "In flight", forms: [draftForm] },
  { label: "Needs review", forms: [submittedForm] },
  { label: "History", forms: [appliedForm, discardedForm] },
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
          { label: "In flight", forms: [] },
          { label: "Needs review", forms: [submittedForm] },
          { label: "History", forms: [] },
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
          { label: "In flight", forms: [], empty: "No forms are out with a client right now." },
          { label: "Needs review", forms: [], empty: "Nothing to review." },
        ]}
      />,
    );
    expect(within(panelFor(/in flight/i)).getByText(/out with a client/i)).toBeInTheDocument();
  });
});
