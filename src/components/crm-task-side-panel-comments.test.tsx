// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
