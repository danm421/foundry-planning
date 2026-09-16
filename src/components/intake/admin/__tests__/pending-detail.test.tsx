// @vitest-environment jsdom
/**
 * The in-flight view of a data-collection form.
 *
 * The regression behind it: every row in the queue's "In flight" tab links to
 * /data-collection/<id>, and that page parsed the payload with the SUBMIT
 * schema before rendering — so a draft (payload `{}`, or half-typed) failed to
 * parse and the page 404'd. Clicking the recipient's name was a dead end for
 * the whole bucket.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PendingDetail from "../pending-detail";
import type { IntakeFormRow } from "@/lib/intake/queries";
import { DEFAULT_INTAKE_SECTIONS } from "@/lib/intake/sections";

function makeForm(overrides: Partial<IntakeFormRow> = {}): IntakeFormRow {
  return {
    id: "form-1",
    firmId: "firm-1",
    clientId: "client-1",
    crmHouseholdId: null,
    mode: "blank",
    status: "draft",
    token: "tok-abc",
    recipientEmail: "jane@example.com",
    recipientName: "Jane Doe",
    payload: {} as IntakeFormRow["payload"],
    sections: null,
    createdByUserId: "user-1",
    sentAt: new Date("2026-09-16T14:30:00Z"),
    openedAt: null,
    submittedAt: null,
    appliedAt: null,
    expiresAt: new Date("2026-10-16T14:30:00Z"),
    createdAt: new Date("2026-09-16T14:30:00Z"),
    updatedAt: new Date("2026-09-16T14:30:00Z"),
    ...overrides,
  };
}

function renderPending(form: IntakeFormRow, documents: never[] = []) {
  return render(
    <PendingDetail
      form={form}
      sections={[...DEFAULT_INTAKE_SECTIONS]}
      documents={documents}
      householdId={null}
    />,
  );
}

/** The row for one section of the "What we asked for" card — scoped to that
 *  card because "Documents" is also the heading of the upload list below it. */
function sectionState(label: string): string {
  const card = within(screen.getByTestId("asked-for"));
  const row = card.getByText(label).parentElement!;
  return within(row).getByText(/added|uploaded|Started|Nothing yet/).textContent!;
}

describe("PendingDetail", () => {
  it("renders an untouched draft instead of failing on an empty payload", () => {
    renderPending(makeForm());

    expect(screen.getByText("Awaiting reply")).toBeTruthy();
    expect(screen.getByText("jane@example.com")).toBeTruthy();
    // The question the advisor came to ask.
    expect(screen.getByText("Opened").parentElement!.textContent).toContain("—");
    expect(screen.getByText(/haven't started yet/i)).toBeTruthy();
  });

  it("never offers Apply or Discard — there is nothing submitted to act on", () => {
    renderPending(makeForm());
    expect(screen.queryByText(/Apply entire form/i)).toBeNull();
    expect(screen.queryByText(/^Discard$/)).toBeNull();
  });

  it("counts only the rows the client actually typed into", () => {
    renderPending(
      makeForm({
        payload: {
          // The wizard autosaves the moment a row is added, so the blank one is
          // a click, not an answer. Counting it would tell the advisor work is
          // done that isn't.
          accounts: [{ name: "Brokerage", value: 25000 }, { name: "" }],
        } as unknown as IntakeFormRow["payload"],
      }),
    );

    expect(sectionState("Accounts")).toBe("1 added");
    expect(sectionState("Income")).toBe("Nothing yet");
    expect(screen.getByText(/save as they type/i)).toBeTruthy();
  });

  it("omits Documents from a portal request — the portal has no upload step", () => {
    renderPending(makeForm({ mode: "prefilled" }));

    expect(screen.getByText("Sent as").parentElement!.textContent).toContain(
      "Portal request",
    );
    expect(screen.queryByText("Documents")).toBeNull();
  });

  it("keeps the uploads an emailed form collected", () => {
    render(
      <PendingDetail
        form={makeForm()}
        sections={[...DEFAULT_INTAKE_SECTIONS]}
        documents={[
          {
            id: "doc-1",
            filename: "1040.pdf",
            docType: "tax_return",
            sizeBytes: 2048,
          } as never,
        ]}
        householdId="hh-1"
      />,
    );

    expect(sectionState("Documents")).toBe("1 uploaded");
    expect(screen.getByText("1040.pdf")).toBeTruthy();
  });

  it("says a revoked form is over rather than inviting a chase", () => {
    renderPending(makeForm({ status: "expired" }));

    // The same word the History tab used for it.
    expect(screen.getAllByText("Expired").length).toBeGreaterThan(0);
    expect(screen.getByText(/can't be filled in any more/i)).toBeTruthy();
    expect(screen.queryByText(/Remind them/i)).toBeNull();
  });

  it("says a LAPSED draft is over too — its link opens onto nothing", () => {
    // Nothing flips a draft to `expired` when it runs past its date: the only
    // writer of that status is the revoke endpoint. Read the date, not the
    // status, or the page invites a chase that Remind can only 409.
    renderPending(makeForm({ expiresAt: new Date("2026-01-01T00:00:00Z") }));

    expect(screen.getByText(/can't be filled in any more/i)).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("renders a draft the advisor discarded before it came back", () => {
    // Discard accepts a draft (`isOpenStatus`), and that row lands in History
    // linking here with a payload that never parsed — the same 404.
    renderPending(makeForm({ status: "discarded" }));

    expect(screen.getByText("Discarded")).toBeTruthy();
    expect(screen.getByText(/can't be filled in any more/i)).toBeTruthy();
    expect(screen.queryByText(/Apply entire form/i)).toBeNull();
  });
});
