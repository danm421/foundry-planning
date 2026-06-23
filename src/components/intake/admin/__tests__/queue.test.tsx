// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
  { label: "Needs review", forms: [submittedForm] },
  { label: "In flight", forms: [draftForm] },
  { label: "History", forms: [appliedForm, discardedForm] },
];

describe("Queue", () => {
  it("renders all three group headers", () => {
    render(<Queue groups={groups} />);
    expect(screen.getByText(/needs review/i)).toBeInTheDocument();
    expect(screen.getByText(/in flight/i)).toBeInTheDocument();
    expect(screen.getByText(/history/i)).toBeInTheDocument();
  });

  it("shows submitted form under Needs review", () => {
    render(<Queue groups={groups} />);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows draft form under In flight", () => {
    render(<Queue groups={groups} />);
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("shows applied and discarded forms under History", () => {
    render(<Queue groups={groups} />);
    expect(screen.getByText("Dave")).toBeInTheDocument();
    expect(screen.getByText("Eve")).toBeInTheDocument();
  });

  it("each row links to the detail route", () => {
    render(<Queue groups={groups} />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/data-collection/f-submitted");
    expect(hrefs).toContain("/data-collection/f-draft");
    expect(hrefs).toContain("/data-collection/f-applied");
  });

  it("renders empty state when no forms exist", () => {
    render(<Queue groups={[{ label: "Needs review", forms: [] }, { label: "In flight", forms: [] }, { label: "History", forms: [] }]} />);
    expect(screen.getByText(/no intake forms yet/i)).toBeInTheDocument();
  });
});
