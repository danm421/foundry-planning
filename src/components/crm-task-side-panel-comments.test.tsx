// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "u_me" } }),
}));

import { CrmTaskSidePanelComments } from "@/components/crm-task-side-panel-comments";
import type { FirmMember } from "@/lib/crm-tasks/members";

const MEMBERS: FirmMember[] = [
  { userId: "u_me", displayName: "Dan Mueller", email: "dan@firm.com", imageUrl: null },
  { userId: "u_jane", displayName: "Jane Smith", email: "jane@firm.com", imageUrl: null },
];

function comment(body: string) {
  return {
    id: "c1",
    authorUserId: "u_jane",
    bodyMarkdown: body,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("mention chips", () => {
  it("renders a token as a chip with the live member name", () => {
    render(
      <CrmTaskSidePanelComments
        taskId="t1"
        initialComments={[comment("ping @[Old Name](user:u_jane) re: IRA")]}
        members={MEMBERS}
      />,
    );
    // Live name from members wins over the snapshot in the token.
    expect(screen.getByText("@Jane Smith")).toBeTruthy();
    expect(screen.queryByText(/user:u_jane/)).toBeNull(); // raw token never shows
  });

  it("falls back to the snapshot name for a departed member", () => {
    render(
      <CrmTaskSidePanelComments
        taskId="t1"
        initialComments={[comment("cc @[Gone Person](user:u_gone)")]}
        members={MEMBERS}
      />,
    );
    expect(screen.getByText("@Gone Person")).toBeTruthy();
  });

  it("emphasizes a self-mention", () => {
    render(
      <CrmTaskSidePanelComments
        taskId="t1"
        initialComments={[comment("@[Dan Mueller](user:u_me) take a look")]}
        members={MEMBERS}
      />,
    );
    const self = screen.getByText("@Dan Mueller");
    expect(self.className).toContain("text-accent-ink");
    const other = render(
      <CrmTaskSidePanelComments
        taskId="t2"
        initialComments={[comment("@[Jane Smith](user:u_jane) fyi")]}
        members={MEMBERS}
      />,
    );
    expect(other.getByText("@Jane Smith").className).not.toContain("text-accent-ink");
  });
});

function setup(initialComments: Parameters<typeof CrmTaskSidePanelComments>[0]["initialComments"] = []) {
  render(
    <CrmTaskSidePanelComments taskId="t1" initialComments={initialComments} members={MEMBERS} />,
  );
  return screen.getByPlaceholderText(/write a comment/i) as HTMLTextAreaElement;
}

/** Type into the textarea with the caret at the end (fireEvent.change leaves selectionStart at value.length). */
function type(ta: HTMLTextAreaElement, value: string) {
  fireEvent.change(ta, { target: { value } });
}

describe("mention composer", () => {
  it("opens the popover on @query and inserts the name on click", () => {
    const ta = setup();
    type(ta, "cc @ja");
    const option = screen.getByRole("option", { name: /jane smith/i });
    fireEvent.click(option);
    expect(ta.value).toBe("cc @Jane Smith ");
    expect(screen.queryByRole("listbox")).toBeNull(); // popover closed
  });

  it("navigates with arrows and picks with Enter", () => {
    const ta = setup();
    type(ta, "@"); // both members match
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    fireEvent.keyDown(ta, { key: "Enter" });
    // Second member (Jane Smith) picked.
    expect(ta.value).toBe("@Jane Smith ");
  });

  it("closes on Escape without inserting", () => {
    const ta = setup();
    type(ta, "@ja");
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(ta.value).toBe("@ja");
  });

  it("does not open for an email-like @", () => {
    const ta = setup();
    type(ta, "dan@gmail");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("posts the tokenized body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        comment: {
          id: "c9",
          authorUserId: "u_me",
          bodyMarkdown: "cc @[Jane Smith](user:u_jane) done",
          createdAt: new Date().toISOString(),
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const ta = setup();
    type(ta, "cc @ja");
    fireEvent.click(screen.getByRole("option", { name: /jane smith/i }));
    type(ta, "cc @Jane Smith done");
    fireEvent.click(screen.getByRole("button", { name: /post/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.bodyMarkdown).toBe("cc @[Jane Smith](user:u_jane) done");
    vi.unstubAllGlobals();
  });
});
