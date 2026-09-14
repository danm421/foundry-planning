import { describe, it, expect } from "vitest";
import { buildActivePeople } from "../active-people";
import { ACTIVE_WINDOW_DAYS, BLOCKED_ACTION, type GrowthInput } from "../types";

const NOW = new Date("2026-09-14T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const EMPTY: GrowthInput = {
  firms: [], subs: [], items: [], activity: [], users: [],
  clientCountByFirm: {}, clientCountByAdvisor: {}, now: NOW,
};

const firm = (over: Partial<GrowthInput["firms"][number]> = {}) => ({
  firmId: "org_1", displayName: "Acme", isFounder: false,
  archivedAt: null, createdAt: day(-30), ...over,
});

const user = (over: Partial<GrowthInput["users"][number]> = {}) => ({
  userId: "user_1", email: "ada@x.com", firstName: "Ada", lastName: "Byron",
  createdAt: day(-30), lastSignInAt: day(-1), hasPendingSignup: false,
  pendingFirmName: null, firmIds: ["org_1"], ...over,
});

const act = (over: Partial<GrowthInput["activity"][number]> = {}) => ({
  firmId: "org_1", actorId: "user_1", action: "client.updated",
  createdAt: day(-1), ...over,
});

/** One person, one firm, one action — the shape most tests vary from. */
const base = (over: Partial<GrowthInput> = {}): GrowthInput => ({
  ...EMPTY, firms: [firm()], users: [user()], activity: [act()], ...over,
});

describe("buildActivePeople — who is on the table", () => {
  it("lists a person who did work inside the window", () => {
    expect(buildActivePeople(base()).map((r) => r.name)).toEqual(["Ada Byron"]);
  });

  it("leaves out a person who did nothing — this is the ACTIVE people table", () => {
    expect(buildActivePeople(base({ activity: [] }))).toEqual([]);
  });

  it("leaves out a person whose only action is older than the window", () => {
    const i = base({ activity: [act({ createdAt: day(-(ACTIVE_WINDOW_DAYS + 1)) })] });
    expect(buildActivePeople(i)).toEqual([]);
  });

  it("does not count a blocked paywall attempt as work", () => {
    const i = base({ activity: [act({ action: BLOCKED_ACTION })] });
    expect(buildActivePeople(i)).toEqual([]);
  });

  it("still lists someone whose only Clerk record is gone, under their user id", () => {
    const i = base({ users: [] });
    const [row] = buildActivePeople(i);
    expect(row.name).toBe("user_1");
    expect(row.lastSignInAt).toBeNull();
  });
});

describe("buildActivePeople — the columns", () => {
  it("names the firm the work happened in", () => {
    expect(buildActivePeople(base())[0].firm).toBe("Acme");
  });

  it("falls back to the firm id when no firm row carries a name", () => {
    const i = base({ firms: [firm({ displayName: null })] });
    expect(buildActivePeople(i)[0].firm).toBe("org_1");
  });

  it("counts the households the person advises, across every firm", () => {
    const i = base({ clientCountByAdvisor: { user_1: 7 } });
    expect(buildActivePeople(i)[0].clients).toBe(7);
  });

  it("reports zero clients rather than blank when the person advises none", () => {
    expect(buildActivePeople(base())[0].clients).toBe(0);
  });

  it("carries the Clerk last sign-in as an ISO string", () => {
    expect(buildActivePeople(base())[0].lastSignInAt).toBe(day(-1).toISOString());
  });

  it("leaves last sign-in null when Clerk has never recorded one", () => {
    const i = base({ users: [user({ lastSignInAt: null })] });
    expect(buildActivePeople(i)[0].lastSignInAt).toBeNull();
  });

  it("counts every qualifying action, not just the distinct days", () => {
    const i = base({
      activity: [act(), act({ createdAt: day(-1.1) }), act({ createdAt: day(-3) })],
    });
    const [row] = buildActivePeople(i);
    expect(row.actions).toBe(3);
    expect(row.daysActive).toBe(2);
  });

  it("excludes a blocked attempt from the action count of an otherwise busy person", () => {
    const i = base({ activity: [act(), act({ action: BLOCKED_ACTION })] });
    expect(buildActivePeople(i)[0].actions).toBe(1);
  });
});

describe("buildActivePeople — days active", () => {
  it("counts a UTC date once no matter how many actions land on it", () => {
    const i = base({
      activity: [
        act({ createdAt: new Date("2026-09-13T01:00:00Z") }),
        act({ createdAt: new Date("2026-09-13T23:00:00Z") }),
      ],
    });
    expect(buildActivePeople(i)[0].daysActive).toBe(1);
  });

  it("separates two calendar days that are under 24 hours apart", () => {
    const i = base({
      activity: [
        act({ createdAt: new Date("2026-09-12T23:00:00Z") }),
        act({ createdAt: new Date("2026-09-13T01:00:00Z") }),
      ],
    });
    expect(buildActivePeople(i)[0].daysActive).toBe(2);
  });

  it("never exceeds the window the column header promises", () => {
    // A rolling 7×24h window straddles EIGHT calendar dates; "of last 7" must
    // not read as 8 of 7.
    const i = base({
      activity: Array.from({ length: 8 }, (_, n) =>
        act({ createdAt: new Date(NOW.getTime() - n * 86_400_000 + 1000) }),
      ),
    });
    expect(buildActivePeople(i)[0].daysActive).toBe(ACTIVE_WINDOW_DAYS);
  });
});

describe("buildActivePeople — one row per person", () => {
  it("merges work done across two firms into a single row", () => {
    const i = base({
      firms: [firm(), firm({ firmId: "org_2", displayName: "Beta" })],
      users: [user({ firmIds: ["org_1", "org_2"] })],
      activity: [
        act({ firmId: "org_1" }),
        act({ firmId: "org_2", createdAt: day(-2) }),
        act({ firmId: "org_2", createdAt: day(-3) }),
      ],
    });
    const rows = buildActivePeople(i);
    expect(rows).toHaveLength(1);
    expect(rows[0].actions).toBe(3);
  });

  it("attributes the person to the firm they worked in most", () => {
    const i = base({
      firms: [firm(), firm({ firmId: "org_2", displayName: "Beta" })],
      users: [user({ firmIds: ["org_1", "org_2"] })],
      activity: [
        act({ firmId: "org_1" }),
        act({ firmId: "org_2", createdAt: day(-2) }),
        act({ firmId: "org_2", createdAt: day(-3) }),
      ],
    });
    expect(buildActivePeople(i)[0].firm).toBe("Beta");
  });

  it("breaks a firm tie by name so the row is stable run to run", () => {
    const i = base({
      firms: [firm({ firmId: "org_z", displayName: "Zeta" }), firm({ firmId: "org_a", displayName: "Alpha" })],
      users: [user({ firmIds: ["org_z", "org_a"] })],
      activity: [act({ firmId: "org_z" }), act({ firmId: "org_a", createdAt: day(-2) })],
    });
    expect(buildActivePeople(i)[0].firm).toBe("Alpha");
  });

  it("keeps two different people apart", () => {
    const i = base({
      users: [user(), user({ userId: "user_2", firstName: "Grace", lastName: "Hopper", email: "g@x.com" })],
      activity: [act(), act({ actorId: "user_2" })],
    });
    expect(buildActivePeople(i).map((r) => r.name).sort()).toEqual(["Ada Byron", "Grace Hopper"]);
  });
});

describe("buildActivePeople — the name", () => {
  it("joins the two Clerk names", () => {
    expect(buildActivePeople(base())[0].name).toBe("Ada Byron");
  });

  it("uses whichever half Clerk has", () => {
    const i = base({ users: [user({ lastName: null })] });
    expect(buildActivePeople(i)[0].name).toBe("Ada");
  });

  it("falls back to the email when Clerk has no name at all", () => {
    const i = base({ users: [user({ firstName: null, lastName: null })] });
    expect(buildActivePeople(i)[0].name).toBe("ada@x.com");
  });

  it("falls back to the user id when there is no name and no email", () => {
    const i = base({ users: [user({ firstName: null, lastName: null, email: null })] });
    expect(buildActivePeople(i)[0].name).toBe("user_1");
  });
});

describe("buildActivePeople — order", () => {
  const busy = (userId: string, name: string, days: number[], extra = 0) => ({
    user: user({ userId, firstName: name, lastName: null, email: `${userId}@x.com` }),
    activity: [
      ...days.map((d) => act({ actorId: userId, createdAt: day(-d) })),
      ...Array.from({ length: extra }, () => act({ actorId: userId, createdAt: day(-days[0]) })),
    ],
  });

  it("puts the most days active first", () => {
    const a = busy("user_1", "Ada", [1, 2, 3]);
    const g = busy("user_2", "Grace", [1]);
    const i = base({ users: [g.user, a.user], activity: [...g.activity, ...a.activity] });
    expect(buildActivePeople(i).map((r) => r.name)).toEqual(["Ada", "Grace"]);
  });

  it("breaks a days tie by the raw action count", () => {
    const a = busy("user_1", "Ada", [1], 4);
    const g = busy("user_2", "Grace", [1]);
    const i = base({ users: [g.user, a.user], activity: [...g.activity, ...a.activity] });
    expect(buildActivePeople(i).map((r) => r.name)).toEqual(["Ada", "Grace"]);
  });

  it("breaks a total tie by name so the table does not reshuffle daily", () => {
    const a = busy("user_1", "Zoe", [1]);
    const g = busy("user_2", "Ada", [1]);
    const i = base({ users: [a.user, g.user], activity: [...a.activity, ...g.activity] });
    expect(buildActivePeople(i).map((r) => r.name)).toEqual(["Ada", "Zoe"]);
  });
});
