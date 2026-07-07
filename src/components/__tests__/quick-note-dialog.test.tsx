// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/use-body-scroll-lock", () => ({ useBodyScrollLock: vi.fn() }));
// The dialog imports the editor through its next/dynamic wrapper; tiptap
// doesn't run in jsdom, so mock the wrapper with a textarea of the same
// contract (mocking the wrapper keeps the render synchronous — a real
// ssr:false dynamic would only paint the loading fallback on first render).
vi.mock("@/components/rich-text-editor-dynamic", () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label="Note body"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { QuickNoteDialog } from "../quick-note-dialog";
import { writeQuickNoteDraft, readQuickNoteDraft } from "@/lib/quick-note-draft";

const CLIENT = "client-1";
const USER = "user_1";

function renderDialog(onOpenChange = vi.fn()) {
  return {
    onOpenChange,
    ...render(
      <QuickNoteDialog open clientId={CLIENT} userId={USER} onOpenChange={onOpenChange} />,
    ),
  };
}

describe("QuickNoteDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("restores an existing draft when opened", () => {
    writeQuickNoteDraft(CLIENT, USER, "picked up where I left off");
    renderDialog();
    expect(screen.getByLabelText("Note body")).toHaveValue("picked up where I left off");
  });

  it("persists the draft as the body changes", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "typing away" } });
    expect(readQuickNoteDraft(CLIENT, USER)).toBe("typing away");
  });

  it("saves to the CRM and clears the draft", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ note: { id: "n1" } }), { status: 201 }));
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "save me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to CRM" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clients/${CLIENT}/crm-note`,
      expect.objectContaining({ method: "POST" }),
    );
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.body).toBe("save me");
    expect(sent.noteDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(readQuickNoteDraft(CLIENT, USER)).toBeNull();
  });

  it("keeps the draft and shows an error when the save fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to CRM" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(readQuickNoteDraft(CLIENT, USER)).toBe("keep me");
  });

  it("keeps typed text when userId resolves late (Clerk arrives after open)", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <QuickNoteDialog open clientId={CLIENT} userId="" onOpenChange={onOpenChange} />,
    );
    fireEvent.change(screen.getByLabelText("Note body"), {
      target: { value: "typed before auth resolved" },
    });
    rerender(
      <QuickNoteDialog open clientId={CLIENT} userId={USER} onOpenChange={onOpenChange} />,
    );
    expect(screen.getByLabelText("Note body")).toHaveValue("typed before auth resolved");
  });

  it("discards the draft after confirmation", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    writeQuickNoteDraft(CLIENT, USER, "doomed");
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(readQuickNoteDraft(CLIENT, USER)).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
