import { describe, it, expect } from "vitest";
import { buildFunnel } from "../funnel";
import type { GrowthInput } from "../types";

const NOW = new Date("2026-09-04T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const EMPTY: GrowthInput = {
  firms: [], subs: [], items: [], activity: [], users: [],
  clientCountByFirm: {}, now: NOW,
};

const user = (over: Partial<GrowthInput["users"][number]> = {}) => ({
  userId: "user_a", email: "a@example.com", firstName: "Ada", lastName: "Byron",
  createdAt: day(-5), lastSignInAt: day(-1),
  hasPendingSignup: false, pendingFirmName: null, firmIds: [], ...over,
});

const firm = (over: Partial<GrowthInput["firms"][number]> = {}) => ({
  firmId: "org_1", displayName: "Acme", isFounder: false,
  archivedAt: null, createdAt: day(-30), ...over,
});

const sub = (over: Partial<GrowthInput["subs"][number]> = {}) => ({
  firmId: "org_1", status: "trialing",
  trialStart: day(-3), trialEnd: day(11), canceledAt: null,
  cancelAtPeriodEnd: false, currentPeriodStart: day(-3), currentPeriodEnd: day(11),
  ...over,
});

function stage(input: GrowthInput, id = "user_a") {
  for (const group of buildFunnel(input)) {
    if (group.people.some((p) => p.userId === id)) return group.stage;
  }
  return null;
}

describe("buildFunnel", () => {
  it("puts an account with no org and no stash in 'signed up'", () => {
    expect(stage({ ...EMPTY, users: [user()] })).toBe("signed_up");
  });

  it("puts an account holding a stash and no org in 'stalled at checkout'", () => {
    expect(
      stage({ ...EMPTY, users: [user({ hasPendingSignup: true, pendingFirmName: "Acme" })] }),
    ).toBe("stalled_checkout");
  });

  it("puts a member of a trialing firm in 'trialing'", () => {
    expect(
      stage({ ...EMPTY, users: [user({ firmIds: ["org_1"] })], firms: [firm()], subs: [sub()] }),
    ).toBe("trialing");
  });

  it("puts a member of a paying firm in 'resolved'", () => {
    expect(
      stage({
        ...EMPTY,
        users: [user({ firmIds: ["org_1"] })],
        firms: [firm()],
        subs: [sub({ status: "active" })],
      }),
    ).toBe("resolved");
  });

  it("counts a user with an org and a stale stash as paid, never as stalled", () => {
    expect(
      stage({
        ...EMPTY,
        users: [user({ firmIds: ["org_1"], hasPendingSignup: true, pendingFirmName: "Acme" })],
        firms: [firm()],
        subs: [sub({ status: "active" })],
      }),
    ).toBe("resolved");
  });

  it("excludes a founder-seated user from the funnel entirely", () => {
    expect(
      stage({
        ...EMPTY,
        users: [user({ firmIds: ["org_1"] })],
        firms: [firm({ isFounder: true })],
        subs: [],
      }),
    ).toBeNull();
  });

  it("carries the stash's firm name so the stalled row is addressable", () => {
    const groups = buildFunnel({
      ...EMPTY,
      users: [user({ hasPendingSignup: true, pendingFirmName: "Byron Wealth" })],
    });
    const person = groups.find((g) => g.stage === "stalled_checkout")!.people[0]!;
    expect(person.firmName).toBe("Byron Wealth");
    expect(person.email).toBe("a@example.com");
    expect(person.name).toBe("Ada Byron");
  });

  it("falls back to the email when the account has no name", () => {
    const groups = buildFunnel({
      ...EMPTY,
      users: [user({ firstName: null, lastName: null })],
    });
    expect(groups.find((g) => g.stage === "signed_up")!.people[0]!.name).toBe("a@example.com");
  });

  it("returns all four stages even when they are empty", () => {
    expect(buildFunnel(EMPTY).map((g) => g.stage)).toEqual([
      "signed_up", "stalled_checkout", "trialing", "resolved",
    ]);
  });
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("the funnel's premise", () => {
  it("clearPendingSignup is called from exactly one place", () => {
    const callers = walk("src")
      .filter((p) => !p.includes("__tests__"))
      .filter((p) => !p.endsWith(join("lib", "billing", "pending-signup.ts")))
      .filter((p) => /\bclearPendingSignup\s*\(/.test(readFileSync(p, "utf8")));

    // If this fails, the "filled the form, never paid" bucket is no longer
    // trustworthy: some other code path now wipes the stash, so people who
    // never paid will silently vanish from the funnel. Fix the dashboard's
    // classification before changing this number.
    expect(callers).toEqual([
      join("src", "lib", "billing", "webhook-handlers", "checkout-session-completed.ts"),
    ]);
  });
});
