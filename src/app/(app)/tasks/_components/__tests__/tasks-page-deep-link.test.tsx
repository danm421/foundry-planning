// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { TaskListRow } from "@/lib/crm-tasks/queries";
import type { FirmMember } from "@/lib/crm-tasks/members";

const nav = vi.hoisted(() => ({
  pathname: "/tasks",
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "u_me" } }),
}));

import { TasksPage } from "../tasks-page";

const ROWS: TaskListRow[] = [
  {
    id: "t_1",
    title: "Call the Coopers",
    status: "open",
    priority: "high",
    dueDate: "2026-01-01",
    householdId: "hh_1",
    householdName: "Cooper",
    assigneeUserId: "u_me",
    recurrence: "none",
    commentCount: 0,
    fileCount: 0,
  },
];

const MEMBERS: FirmMember[] = [
  { userId: "u_me", displayName: "Dan Mueller", email: "dan@firm.com", imageUrl: null, role: "Admin" },
];

function renderPage(props: Partial<Parameters<typeof TasksPage>[0]> = {}) {
  return render(
    <TasksPage
      initialRows={ROWS}
      members={MEMBERS}
      households={[{ id: "hh_1", name: "Cooper" }]}
      firmTags={[]}
      {...props}
    />,
  );
}

/** Href of the row deep-link, parsed so param order doesn't matter. */
function rowLink(): URL {
  const link = screen.getByRole("link", { name: /Call the Coopers/ });
  return new URL(link.getAttribute("href") ?? "", "https://x.test");
}

beforeEach(() => {
  nav.pathname = "/tasks";
  nav.params = new URLSearchParams();
});

describe("task row deep-link", () => {
  it("carries the active quick filter into the row link", () => {
    nav.params = new URLSearchParams("quick=overdue");
    renderPage();

    const url = rowLink();
    expect(url.pathname).toBe("/tasks");
    expect(url.searchParams.get("task")).toBe("t_1");
    // Without this the panel opens at `/tasks?task=t_1`, and closing it
    // strands the user on the default "Open" preset.
    expect(url.searchParams.get("quick")).toBe("overdue");
  });

  it("carries the other list-scoping params too", () => {
    nav.params = new URLSearchParams("quick=mine&tagId=tag_1&priority=high&assignee=u_jane");
    renderPage();

    const url = rowLink();
    expect(url.searchParams.get("quick")).toBe("mine");
    expect(url.searchParams.get("tagId")).toBe("tag_1");
    expect(url.searchParams.get("priority")).toBe("high");
    expect(url.searchParams.get("assignee")).toBe("u_jane");
  });

  it("does not re-emit panel-open params", () => {
    nav.params = new URLSearchParams("quick=done&task=t_other&new=1");
    renderPage();

    const url = rowLink();
    expect(url.searchParams.get("task")).toBe("t_1");
    expect(url.searchParams.get("quick")).toBe("done");
    expect(url.searchParams.has("new")).toBe(false);
  });

  it("keeps the household tab anchor and the quick filter together", () => {
    nav.pathname = "/crm/households/hh_1";
    nav.params = new URLSearchParams("tab=tasks&quick=overdue");
    renderPage({ scopeHouseholdId: "hh_1" });

    const url = rowLink();
    expect(url.pathname).toBe("/crm/households/hh_1");
    expect(url.searchParams.get("tab")).toBe("tasks");
    expect(url.searchParams.get("quick")).toBe("overdue");
    expect(url.searchParams.get("task")).toBe("t_1");
  });
});
