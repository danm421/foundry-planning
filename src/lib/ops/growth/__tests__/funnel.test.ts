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

/** Drops `/* *\/` block comments and WHOLE-LINE `//` comments (the line must
 * start with `//`, ignoring leading whitespace). Deliberately does NOT strip
 * a trailing `//` that shares a line with real code — an unanchored version
 * would also eat the `//` inside a `"https://..."` string and delete a real
 * call sitting after it on the same line. The accepted trade-off: a
 * `// clearPendingSignup()` comment appended after real code on the same
 * line can still cause a false positive below. That's rare and safe — a
 * false positive is a review nuisance, a false negative is silent damage. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** True only if the file both imports the symbol and calls it — covering a
 * named import (`import { clearPendingSignup }`, called bare) and a
 * namespace import (`import * as ns from ".../pending-signup"`, called as
 * `ns.clearPendingSignup(...)`). An aliased named import
 * (`import { clearPendingSignup as x }`, called as `x(...)`) is NOT
 * detected — text scanning can't follow a rename to its call site. That gap
 * is known and accepted; see the tests below. */
function callsClearPendingSignup(source: string): boolean {
  const code = stripComments(source);

  const namedImport = /import\s*\{[^}]*\bclearPendingSignup\b[^}]*\}/.test(code);
  if (namedImport && /\bclearPendingSignup\s*\(/.test(code)) return true;

  const namespaceImport = code.match(
    /import\s*\*\s*as\s+(\w+)\s+from\s*["'][^"']*pending-signup["']/,
  );
  if (namespaceImport) {
    const ns = namespaceImport[1];
    if (new RegExp(`\\b${ns}\\s*\\.\\s*clearPendingSignup\\s*\\(`).test(code)) return true;
  }

  return false;
}

describe("callsClearPendingSignup", () => {
  it("detects a named import and a bare call", () => {
    expect(
      callsClearPendingSignup(
        'import { clearPendingSignup } from "@/lib/billing/pending-signup";\nclearPendingSignup(id);',
      ),
    ).toBe(true);
  });

  it("detects a namespace import and a call through the binding", () => {
    expect(
      callsClearPendingSignup(
        'import * as ns from "@/lib/billing/pending-signup";\nawait ns.clearPendingSignup(id);',
      ),
    ).toBe(true);
  });

  it("misses a call through a renamed alias — a known, accepted gap of text scanning", () => {
    expect(
      callsClearPendingSignup(
        'import { clearPendingSignup as clear } from "@/lib/billing/pending-signup";\nclear(id);',
      ),
    ).toBe(false);
  });

  it("does not mistake the // inside a URL for a comment that swallows a real call", () => {
    expect(
      callsClearPendingSignup(
        'import { clearPendingSignup } from "@/lib/billing/pending-signup";\n' +
          'const DOCS = "https://example.com/webhooks"; await clearPendingSignup(id);',
      ),
    ).toBe(true);
  });

  it("ignores a prose mention with no import", () => {
    expect(
      callsClearPendingSignup("// clearPendingSignup() is called from the webhook"),
    ).toBe(false);
  });

  it("ignores a bare import with no call", () => {
    expect(
      callsClearPendingSignup(
        'import { clearPendingSignup } from "@/lib/billing/pending-signup";\nconst unused = clearPendingSignup;',
      ),
    ).toBe(false);
  });
});

describe("the funnel's premise", () => {
  it("clearPendingSignup is called from exactly one place", () => {
    const callers = walk("src")
      .filter((p) => !p.includes("__tests__"))
      .filter((p) => !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"))
      .filter((p) => !p.endsWith(join("lib", "billing", "pending-signup.ts")))
      .filter((p) => callsClearPendingSignup(readFileSync(p, "utf8")));

    // Comments are stripped and an import is required alongside the call, so
    // neither a prose mention nor a bare import can trip this — a failure
    // here means a genuine new call site. Fix the dashboard's funnel
    // classification (the "filled the form, never paid" bucket) before
    // changing this list.
    expect(callers).toEqual([
      join("src", "lib", "billing", "webhook-handlers", "checkout-session-completed.ts"),
    ]);
  });
});
