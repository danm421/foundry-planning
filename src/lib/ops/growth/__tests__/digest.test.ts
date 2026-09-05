import { describe, it, expect } from "vitest";
import { buildDigest } from "../digest";
import type { AttentionRow } from "../attention";

const URL = "https://app.foundryplanning.com/admin/growth";

const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  kind: "trial_ending",
  headline: "Trial ends in 2 days",
  who: "Acme",
  email: null,
  firmId: "org_1",
  at: "2026-09-06T12:00:00.000Z",
  ...over,
});

describe("buildDigest", () => {
  it("returns null on a quiet day", () => {
    expect(buildDigest([], URL)).toBeNull();
  });

  it("counts the rows in the subject", () => {
    const d = buildDigest([row(), row({ kind: "canceled", headline: "Cancelled" })], URL)!;
    expect(d.subject).toBe("Foundry: 2 things need you");
  });

  it("uses the singular for one row", () => {
    expect(buildDigest([row()], URL)!.subject).toBe("Foundry: 1 thing needs you");
  });

  it("writes one line per row, headline and name", () => {
    const d = buildDigest([row()], URL)!;
    expect(d.text).toContain("Acme — Trial ends in 2 days");
  });

  it("includes the email address when there is one", () => {
    const d = buildDigest([row({ who: "Ada Byron", email: "ada@x.com" })], URL)!;
    expect(d.text).toContain("Ada Byron <ada@x.com> — Trial ends in 2 days");
  });

  it("groups rows under a heading per kind", () => {
    const d = buildDigest(
      [row(), row({ kind: "new_signup", headline: "New account", who: "Ada" })],
      URL,
    )!;
    expect(d.text).toContain("Trials ending");
    expect(d.text).toContain("New signups");
  });

  it("links back to the dashboard", () => {
    expect(buildDigest([row()], URL)!.text).toContain(URL);
  });
});
