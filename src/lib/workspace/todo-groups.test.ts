import { describe, expect, it } from "vitest";
import type { TaskListRow } from "@/lib/crm-tasks/queries";
import type { WorkspaceTodo } from "./types";
import { groupTodos, toTodoItems, type TodoItem } from "./todo-groups";

const TODAY = "2026-10-28"; // a Wednesday

function task(over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    id: "task-1",
    title: "Prep Nguyen proposal",
    status: "open",
    priority: "med",
    dueDate: null,
    householdId: "hh-1",
    householdName: "Nguyen household",
    assigneeUserId: "user_1",
    recurrence: "none",
    commentCount: 0,
    fileCount: 0,
    ...over,
  };
}

function todo(over: Partial<WorkspaceTodo> = {}): WorkspaceTodo {
  return {
    source: "outlook",
    id: "AAMk/task=",
    listId: "AAMk/list=",
    title: "Send Hartley the updated plan",
    dueDate: null,
    notes: "",
    ...over,
  };
}

function item(title: string, dueDate: string | null): TodoItem {
  return { key: title, source: "outlook", title, dueDate, meta: null, href: null };
}

describe("toTodoItems", () => {
  it("labels a high-priority Foundry task with its household and links to it", () => {
    const [foundry] = toTodoItems([task({ id: "t-9", priority: "high" })], []);
    expect(foundry.source).toBe("foundry");
    expect(foundry.meta).toBe("Nguyen household · High");
    expect(foundry.href).toBe("/tasks?task=t-9");
    expect(foundry.foundry).toEqual({ taskId: "t-9" });
  });

  it("names only the household when the priority isn't high", () => {
    const [foundry] = toTodoItems([task({ priority: "med" })], []);
    expect(foundry.meta).toBe("Nguyen household");
  });

  it("shows High alone without a household, and nothing for neither", () => {
    const [high, plain] = toTodoItems(
      [
        task({ id: "a", priority: "high", householdId: null, householdName: null }),
        task({ id: "b", priority: "low", householdId: null, householdName: null }),
      ],
      [],
    );
    expect(high.meta).toBe("High");
    expect(plain.meta).toBeNull();
  });

  it("keeps an Outlook to-do's list and task ids, with no meta and no link", () => {
    const [outlook] = toTodoItems([], [todo({ dueDate: "2026-10-30" })]);
    expect(outlook).toMatchObject({
      source: "outlook",
      title: "Send Hartley the updated plan",
      dueDate: "2026-10-30",
      meta: null,
      href: null,
      outlook: { listId: "AAMk/list=", taskId: "AAMk/task=" },
    });
  });

  it("gives every item a key unique across both sources", () => {
    const items = toTodoItems([task({ id: "x" })], [todo({ id: "x" })]);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });
});

describe("groupTodos", () => {
  it("files each due date into its group", () => {
    const groups = groupTodos(
      [
        item("yesterday", "2026-10-27"),
        item("today", "2026-10-28"),
        item("sunday", "2026-11-01"),
        item("next monday", "2026-11-02"),
        item("someday", null),
      ],
      TODAY,
    );
    expect(groups.overdue.map((i) => i.title)).toEqual(["yesterday"]);
    expect(groups.today.map((i) => i.title)).toEqual(["today"]);
    expect(groups.thisWeek.map((i) => i.title)).toEqual(["sunday"]);
    expect(groups.later.map((i) => i.title)).toEqual(["next monday"]);
    expect(groups.noDate.map((i) => i.title)).toEqual(["someday"]);
  });

  it("starts this week tomorrow", () => {
    expect(groupTodos([item("thursday", "2026-10-29")], TODAY).thisWeek).toHaveLength(1);
  });

  it("on a Sunday, tomorrow is already later", () => {
    const groups = groupTodos([item("monday", "2026-11-02")], "2026-11-01");
    expect(groups.thisWeek).toEqual([]);
    expect(groups.later.map((i) => i.title)).toEqual(["monday"]);
  });

  it("sorts each group by due date, then title", () => {
    const groups = groupTodos(
      [
        item("Renew E&O policy", "2026-11-14"),
        item("Call Schwab", "2026-11-03"),
        item("Book venue", "2026-11-14"),
        item("Zebra", null),
        item("Apple", null),
      ],
      TODAY,
    );
    expect(groups.later.map((i) => i.title)).toEqual(["Call Schwab", "Book venue", "Renew E&O policy"]);
    expect(groups.noDate.map((i) => i.title)).toEqual(["Apple", "Zebra"]);
  });
});
