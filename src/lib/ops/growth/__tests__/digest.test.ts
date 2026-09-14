import { describe, it, expect } from "vitest";
import { buildDigest } from "../digest";
import type { AttentionRow } from "../attention";
import type { AccountRow } from "../accounts";

const URL = "https://app.foundryplanning.com/admin/growth";

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

describe("buildDigest — when it sends at all", () => {
  it("returns null with no rows and no accounts", () => {
    expect(buildDigest([], [], URL)).toBeNull();
  });

  it("sends for a live trial even when nothing else needs attention", () => {
    expect(buildDigest([], [account()], URL)).not.toBeNull();
  });

  it("counts accounts and other rows together in the subject", () => {
    const d = buildDigest([row()], [account(), account({ firm: "Beta" })], URL)!;
    expect(d.subject).toBe("Foundry: 3 things need you");
  });

  it("uses the singular for one item", () => {
    expect(buildDigest([], [account()], URL)!.subject).toBe("Foundry: 1 thing needs you");
  });

  it("does not count trial_ending or canceled twice — the table owns them", () => {
    const d = buildDigest(
      [row({ kind: "trial_ending" }), row({ kind: "canceled" })],
      [account()],
      URL,
    )!;
    expect(d.subject).toBe("Foundry: 1 thing needs you");
    expect(d.text).not.toContain("Trials ending");
    expect(d.text).not.toContain("Cancellations");
  });
});

describe("buildDigest — the accounts table", () => {
  it("names the firm, the person, their email, the days left and the status", () => {
    const d = buildDigest([], [account()], URL)!;
    expect(d.text).toContain("Acme — Ada Byron <ada@x.com> — trial: 10 days — Trialing");
  });

  it("shows a cancellation on the same row as the trial", () => {
    const d = buildDigest([], [account({ trialDaysLeft: 1, canceled: "Canceled" })], URL)!;
    expect(d.text).toContain("Acme — Ada Byron <ada@x.com> — trial: 1 day — Canceled");
  });

  it("reads a trial with hours left as ending today, not as a day", () => {
    expect(buildDigest([], [account({ trialDaysLeft: 0 })], URL)!.text).toContain(
      "trial: ends today",
    );
  });

  it("dashes the trial column for a cancellation that is no longer trialing", () => {
    const d = buildDigest([], [account({ trialDaysLeft: null, canceled: "Canceled" })], URL)!;
    expect(d.text).toContain("trial: — — Canceled");
  });

  it("falls back to the email when Clerk has no name", () => {
    const d = buildDigest([], [account({ contactName: null })], URL)!;
    expect(d.text).toContain("Acme — ada@x.com <ada@x.com>");
  });

  it("flags a firm with more members than the one contact", () => {
    expect(buildDigest([], [account({ otherMembers: 2 })], URL)!.text).toContain("Ada Byron +2");
  });

  it("renders an HTML table with a header row and a mailto link", () => {
    const html = buildDigest([], [account()], URL)!.html;
    expect(html).toContain("<table");
    expect(html).toContain(">Firm</th>");
    expect(html).toContain(">Email</th>");
    expect(html).toContain('href="mailto:ada@x.com"');
  });

  it("escapes a firm name that contains markup, single quotes included", () => {
    const html = buildDigest([], [account({ firm: `A&B <script>"x" 'y'` })], URL)!.html;
    expect(html).toContain("A&amp;B &lt;script&gt;&quot;x&quot; &#39;y&#39;");
    expect(html).not.toContain("<script>");
  });
});

describe("buildDigest — everything else", () => {
  it("still groups the non-table kinds under their headings", () => {
    const d = buildDigest(
      [row(), row({ kind: "stalled_checkout", headline: "Filled in setup, never paid" })],
      [],
      URL,
    )!;
    expect(d.text).toContain("New signups");
    expect(d.text).toContain("Stalled at checkout");
  });

  it("includes the email address when there is one", () => {
    const d = buildDigest([row({ email: "ada@x.com" })], [], URL)!;
    expect(d.text).toContain("Ada Byron <ada@x.com> — New account, hasn't started setup");
  });

  it("links back to the dashboard in both bodies", () => {
    const d = buildDigest([row()], [], URL)!;
    expect(d.text).toContain(URL);
    expect(d.html).toContain(`href="${URL}"`);
  });
});
