import { describe, it, expect } from "vitest";
import { buildDigest } from "../digest";
import type { AttentionRow } from "../attention";
import type { AccountRow } from "../accounts";
import type { ActivePersonRow } from "../active-people";
import { MAX_PEOPLE_ROWS } from "../digest";

const URL = "https://app.foundryplanning.com/admin/growth";

/** buildDigest takes one object; every call below goes through this. */
const digest = (
  over: Partial<{
    rows: AttentionRow[];
    accounts: AccountRow[];
    people: ActivePersonRow[];
    dashboardUrl: string;
  }> = {},
) => buildDigest({ rows: [], accounts: [], people: [], dashboardUrl: URL, ...over });

const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  kind: "new_signup",
  headline: "New account, hasn't started setup",
  who: "Ada Byron",
  email: null,
  firmId: null,
  at: "2026-09-06T12:00:00.000Z",
  ...over,
});

const account = (over: Partial<AccountRow> = {}): AccountRow => ({
  firm: "Acme",
  contactName: "Ada Byron",
  contactEmail: "ada@x.com",
  otherMembers: 0,
  trialDaysLeft: 10,
  canceled: null,
  canceledAt: null,
  ...over,
});

const person = (over: Partial<ActivePersonRow> = {}): ActivePersonRow => ({
  firm: "Acme",
  name: "Ada Byron",
  clients: 7,
  daysActive: 5,
  lastSignInAt: "2026-09-13T08:30:00.000Z",
  actions: 42,
  ...over,
});

describe("buildDigest — when it sends at all", () => {
  it("returns null with no rows and no accounts", () => {
    expect(digest()).toBeNull();
  });

  it("sends for a live trial even when nothing else needs attention", () => {
    expect(digest({ accounts: [account()] })).not.toBeNull();
  });

  it("counts accounts and other rows together in the subject", () => {
    const d = digest({ rows: [row()], accounts: [account(), account({ firm: "Beta" })] })!;
    expect(d.subject).toBe("Foundry: 3 things need you");
  });

  it("uses the singular for one item", () => {
    expect(digest({ accounts: [account()] })!.subject).toBe("Foundry: 1 thing needs you");
  });

  it("does not count trial_ending or canceled twice — the table owns them", () => {
    const d = digest({
      rows: [row({ kind: "trial_ending" }), row({ kind: "canceled" })],
      accounts: [account()],
    })!;
    expect(d.subject).toBe("Foundry: 1 thing needs you");
    expect(d.text).not.toContain("Trials ending");
    expect(d.text).not.toContain("Cancellations");
  });
});

describe("buildDigest — the accounts table", () => {
  it("names the firm, the person, their email, the days left and the status", () => {
    const d = digest({ accounts: [account()] })!;
    expect(d.text).toContain("Acme — Ada Byron <ada@x.com> — trial: 10 days — Trialing");
  });

  it("shows a cancellation on the same row as the trial", () => {
    const d = digest({ accounts: [account({ trialDaysLeft: 1, canceled: "Canceled" })] })!;
    expect(d.text).toContain("Acme — Ada Byron <ada@x.com> — trial: 1 day — Canceled");
  });

  it("reads a trial with hours left as ending today, not as a day", () => {
    expect(digest({ accounts: [account({ trialDaysLeft: 0 })] })!.text).toContain(
      "trial: ends today",
    );
  });

  it("dashes the trial column for a cancellation that is no longer trialing", () => {
    const d = digest({ accounts: [account({ trialDaysLeft: null, canceled: "Canceled" })] })!;
    expect(d.text).toContain("trial: — — Canceled");
  });

  it("falls back to the email when Clerk has no name", () => {
    const d = digest({ accounts: [account({ contactName: null })] })!;
    expect(d.text).toContain("Acme — ada@x.com <ada@x.com>");
  });

  it("flags a firm with more members than the one contact", () => {
    expect(digest({ accounts: [account({ otherMembers: 2 })] })!.text).toContain("Ada Byron +2");
  });

  it("renders an HTML table with a header row and a mailto link", () => {
    const html = digest({ accounts: [account()] })!.html;
    expect(html).toContain("<table");
    expect(html).toContain(">Firm</th>");
    expect(html).toContain(">Email</th>");
    expect(html).toContain('href="mailto:ada@x.com"');
  });

  it("escapes a firm name that contains markup, single quotes included", () => {
    const html = digest({ accounts: [account({ firm: `A&B <script>"x" 'y'` })] })!.html;
    expect(html).toContain("A&amp;B &lt;script&gt;&quot;x&quot; &#39;y&#39;");
    expect(html).not.toContain("<script>");
  });
});

describe("buildDigest — everything else", () => {
  it("still groups the non-table kinds under their headings", () => {
    const d = digest({
      rows: [row(), row({ kind: "stalled_checkout", headline: "Filled in setup, never paid" })],
    })!;
    expect(d.text).toContain("New signups");
    expect(d.text).toContain("Stalled at checkout");
  });

  it("includes the email address when there is one", () => {
    const d = digest({ rows: [row({ email: "ada@x.com" })] })!;
    expect(d.text).toContain("Ada Byron <ada@x.com> — New account, hasn't started setup");
  });

  it("links back to the dashboard in both bodies", () => {
    const d = digest({ rows: [row()] })!;
    expect(d.text).toContain(URL);
    expect(d.html).toContain(`href="${URL}"`);
  });
});

describe("buildDigest — the most active people table", () => {
  it("never keeps the email alive on its own — someone is always a little active", () => {
    expect(digest({ people: [person()] })).toBeNull();
  });

  it("stays out of the subject count when the digest is already sending", () => {
    const d = digest({ accounts: [account()], people: [person(), person({ name: "Grace" })] })!;
    expect(d.subject).toBe("Foundry: 1 thing needs you");
  });

  it("names the firm, the person, their clients, days, sign-in and actions", () => {
    const d = digest({ accounts: [account()], people: [person()] })!;
    expect(d.text).toContain(
      "Acme — Ada Byron — 7 clients — active 5 of 7 days — last sign-in Sep 13 — 42 actions",
    );
  });

  it("uses the singular for a person with one client and one action", () => {
    const d = digest({ accounts: [account()], people: [person({ clients: 1, actions: 1 })] })!;
    expect(d.text).toContain("1 client —");
    expect(d.text).toContain("1 action");
  });

  it("says never rather than a date when Clerk has no sign-in", () => {
    const d = digest({ accounts: [account()], people: [person({ lastSignInAt: null })] })!;
    expect(d.text).toContain("last sign-in never");
  });

  it("renders an HTML table with every promised column header", () => {
    const html = digest({ accounts: [account()], people: [person()] })!.html;
    expect(html).toContain("Most active people");
    expect(html).toContain(">Clients</th>");
    expect(html).toContain(">Days active</th>");
    expect(html).toContain(">Last sign-in</th>");
    expect(html).toContain(">Actions (7d)</th>");
  });

  it("shows days active against the window, not as a bare number", () => {
    const html = digest({ accounts: [account()], people: [person()] })!.html;
    expect(html).toContain("5 of 7");
  });

  it("sits below the trials and cancellations table in both bodies", () => {
    const d = digest({ accounts: [account()], people: [person()] })!;
    expect(d.text.indexOf("Most active people")).toBeGreaterThan(
      d.text.indexOf("Trials and cancellations"),
    );
    expect(d.html.indexOf("Most active people")).toBeGreaterThan(
      d.html.indexOf("Trials and cancellations"),
    );
  });

  it("is absent entirely when nobody was active", () => {
    const d = digest({ accounts: [account()] })!;
    expect(d.text).not.toContain("Most active people");
    expect(d.html).not.toContain("Most active people");
  });

  it("escapes a name that contains markup", () => {
    const html = digest({ accounts: [account()], people: [person({ name: "<b>Ada</b>" })] })!.html;
    expect(html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(html).not.toContain("<b>Ada</b>");
  });
});

describe("buildDigest — the active-people cap", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      person({ name: `Person ${String(i).padStart(2, "0")}`, daysActive: 7, actions: 100 - i }),
    );

  it("renders every row when the list is at the cap", () => {
    const d = digest({ accounts: [account()], people: many(MAX_PEOPLE_ROWS) })!;
    expect(d.text).toContain(`Person ${String(MAX_PEOPLE_ROWS - 1).padStart(2, "0")}`);
    expect(d.text).not.toContain("more, on the dashboard");
  });

  it("renders only the cap and says how many were left off", () => {
    const d = digest({ accounts: [account()], people: many(MAX_PEOPLE_ROWS + 6) })!;
    expect(d.text).toContain("Person 00");
    expect(d.text).toContain(`Person ${String(MAX_PEOPLE_ROWS - 1).padStart(2, "0")}`);
    expect(d.text).not.toContain(`Person ${String(MAX_PEOPLE_ROWS).padStart(2, "0")}`);
    expect(d.text).toContain("and 6 more, on the dashboard");
    // "more" is invariant — plural() would have written "6 mores".
    expect(d.text).not.toContain("mores");
  });

  it("keeps the busiest people — the cap takes the head, not a slice of the tail", () => {
    const d = digest({ accounts: [account()], people: many(MAX_PEOPLE_ROWS + 3) })!;
    const first = d.text.indexOf("Person 00");
    const last = d.text.indexOf(`Person ${String(MAX_PEOPLE_ROWS - 1).padStart(2, "0")}`);
    expect(first).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(first);
  });

  it("says it in the HTML body too, linking the dashboard", () => {
    const html = digest({ accounts: [account()], people: many(MAX_PEOPLE_ROWS + 2) })!.html;
    expect(html).toContain("and 2 more →");
    expect(html).not.toContain("mores");
    expect(html).toContain(`href="${URL}"`);
  });

  it("uses the singular for exactly one person over the cap", () => {
    const d = digest({ accounts: [account()], people: many(MAX_PEOPLE_ROWS + 1) })!;
    expect(d.text).toContain("and 1 more, on the dashboard");
  });

  it("still does not count the people toward the subject, capped or not", () => {
    const d = digest({ accounts: [account()], people: many(MAX_PEOPLE_ROWS + 20) })!;
    expect(d.subject).toBe("Foundry: 1 thing needs you");
  });
});
