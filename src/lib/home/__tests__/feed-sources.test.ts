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

  it("suppresses the plain birthday row when a milestone lands on the same date", () => {
    // Turns 62 (Social Security eligibility) on 2026-07-25 -- the milestone
    // has no calendar offset, so its date is identical to the birthday's.
    // Only the richer milestone row should survive; the plain birthday row
    // for the same date is a duplicate and must be dropped.
    const items = contactToFeedItems(
      {
        id: "c6",
        firstName: "Nora",
        lastName: "Vance",
        dateOfBirth: "1964-07-25",
        householdId: "h6",
        householdName: "Vance Household",
      },
      TODAY,
    );
    const sameDate = items.filter(
      (i) => i.when.getTime() === new Date(2026, 6, 25).getTime(),
    );
    expect(sameDate).toHaveLength(1);
    expect(sameDate[0].kind).toBe("milestone");
    expect(sameDate[0].title).toBe("Nora Vance turns 62");
    expect(sameDate[0].subtitle).toBe("Social Security eligibility");
  });

  it("keeps the birthday row and an unrelated milestone row when their dates differ", () => {
    // The 59½ milestone (birthday + 6 calendar months) can never land in the
    // 90-day milestone window for the SAME contact whose annual birthday is
    // also in the 30-day birthday window -- the ~6-month offset always
    // pushes it outside that combined range (verified by brute-force search
    // across DOBs/today values: no combination produces an overlap). So this
    // uses two contacts to prove the same-date suppression is scoped to
    // (contact, date) and doesn't leak into suppressing an unrelated
    // birthday row elsewhere in the feed.
    const birthdayItems = contactToFeedItems(
      {
        id: "c7",
        firstName: "Alex",
        lastName: "Storm",
        dateOfBirth: "1980-07-20",
        householdId: "h7",
        householdName: "Storm Household",
      },
      TODAY,
    );
    const milestoneItems = contactToFeedItems(
      {
        id: "c8",
        firstName: "Priya",
        lastName: "Chandra",
        dateOfBirth: "1967-02-01",
        householdId: "h8",
        householdName: "Chandra Household",
      },
      TODAY,
    );
    expect(birthdayItems).toHaveLength(1);
    expect(birthdayItems[0].kind).toBe("birthday");
    expect(milestoneItems).toHaveLength(1);
    expect(milestoneItems[0].kind).toBe("milestone");
    expect(milestoneItems[0].title).toBe("Priya Chandra turns 59½");
    expect(milestoneItems[0].when.getTime()).not.toBe(
      birthdayItems[0].when.getTime(),
    );
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
