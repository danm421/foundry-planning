import { describe, expect, it } from "vitest";
import { contactToFeedItems, mentionToFeedItem } from "../feed-sources";

const TODAY = new Date(2026, 6, 16);

describe("contactToFeedItems", () => {
  it("emits a birthday item inside 30 days", () => {
    const items = contactToFeedItems(
      {
        id: "c1",
        firstName: "Jane",
        lastName: "Cooper",
        dateOfBirth: "1980-08-01",
        householdId: "h1",
        householdName: "Cooper Household",
      },
      TODAY,
    );
    const bday = items.find((i) => i.kind === "birthday");
    expect(bday).toBeDefined();
    expect(bday!.title).toBe("Jane Cooper turns 46");
    expect(bday!.href).toBe("/crm/households/h1");
  });

  it("emits a milestone item inside 90 days with why-copy subtitle", () => {
    const items = contactToFeedItems(
      {
        id: "c2",
        firstName: "Sam",
        lastName: "Rivers",
        dateOfBirth: "1953-08-01", // turns 73 on 2026-08-01
        householdId: "h2",
        householdName: "Rivers Household",
      },
      TODAY,
    );
    const ms = items.find((i) => i.kind === "milestone");
    expect(ms).toBeDefined();
    expect(ms!.title).toBe("Sam Rivers turns 73");
    expect(ms!.subtitle).toBe("Required minimum distributions begin");
    expect(ms!.id).toBe("milestone:c2:73");
  });

  it("returns [] for null DOB", () => {
    expect(
      contactToFeedItems(
        {
          id: "c3",
          firstName: "A",
          lastName: "B",
          dateOfBirth: null,
          householdId: "h3",
          householdName: "X",
        },
        TODAY,
      ),
    ).toEqual([]);
  });
});

describe("mentionToFeedItem", () => {
  it("self-describes the mention with the task title in curly quotes", () => {
    const when = new Date(2026, 6, 15, 9, 30);
    const item = mentionToFeedItem({
      id: "m1",
      taskId: "t1",
      taskTitle: "Review Cooper IRA rollover",
      body: "ping",
      createdAt: when,
    });
    expect(item.title).toBe("You were mentioned on “Review Cooper IRA rollover”");
    expect(item.id).toBe("mention:m1");
    expect(item.kind).toBe("mention");
    expect(item.href).toBe("/tasks?task=t1");
    expect(item.when).toBe(when);
  });
});
