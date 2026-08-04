import { describe, it, expect } from "vitest";
import { planDigestBatches, renderDigestEmail } from "../digest";
import { escapeHtml } from "@/lib/html-escape";
import type { PendingRow } from "../digest";

const row = (over: Partial<PendingRow> = {}): PendingRow => ({
  id: "n-1",
  userId: "u1",
  email: "advisor@example.com",
  displayName: "Jane",
  category: "intake_submitted",
  title: "The Johnsons submitted their intake form",
  body: null,
  url: "/data-collection/form-1",
  createdAt: new Date("2026-08-03T12:00:00.000Z"),
  ...over,
});

describe("planDigestBatches", () => {
  it("groups rows by user", () => {
    const batches = planDigestBatches(
      [row({ id: "a" }), row({ id: "b", userId: "u2", email: "b@x.com" }), row({ id: "c" })],
      50,
    );
    expect(batches).toHaveLength(2);
    expect(batches.find((b) => b.userId === "u1")!.rows).toHaveLength(2);
  });

  it("caps rendered rows but keeps EVERY id for stamping", () => {
    const rows = Array.from({ length: 63 }, (_, i) => row({ id: `n-${i}` }));
    const [batch] = planDigestBatches(rows, 50);
    expect(batch.rows).toHaveLength(50);
    expect(batch.truncated).toBe(13);
    // The whole point: all 63 get stamped, so tomorrow's email is not a
    // staler copy of today's.
    expect(batch.allIds).toHaveLength(63);
  });

  it("reports truncated 0 when under the cap", () => {
    const [batch] = planDigestBatches([row()], 50);
    expect(batch.truncated).toBe(0);
    expect(batch.allIds).toEqual(["n-1"]);
  });

  it("drops a user with no deliverable email address", () => {
    expect(planDigestBatches([row({ email: "" })], 50)).toEqual([]);
  });

  it("returns [] for no rows", () => {
    expect(planDigestBatches([], 50)).toEqual([]);
  });
});

describe("renderDigestEmail", () => {
  const origin = "https://app.foundryplanning.com";

  it("puts the Dates section first, ahead of event categories", () => {
    const [batch] = planDigestBatches(
      [
        row({ id: "a", category: "intake_submitted", title: "Intake in" }),
        row({ id: "b", category: "client_birthday", title: "Ada turns 52" }),
      ],
      50,
    );
    const { html } = renderDigestEmail(batch, origin);
    expect(html.indexOf("Ada turns 52")).toBeLessThan(html.indexOf("Intake in"));
  });

  it("counts the items in the subject", () => {
    const [batch] = planDigestBatches([row({ id: "a" }), row({ id: "b" })], 50);
    expect(renderDigestEmail(batch, origin).subject).toBe("2 updates across your book");
  });

  it("singularises a lone update", () => {
    const [batch] = planDigestBatches([row()], 50);
    expect(renderDigestEmail(batch, origin).subject).toBe("1 update across your book");
  });

  it("absolutises relative urls against the origin", () => {
    const [batch] = planDigestBatches([row()], 50);
    expect(renderDigestEmail(batch, origin).html).toContain(
      `${origin}/data-collection/form-1`,
    );
  });

  it("shows an 'and N more' link when truncated", () => {
    const rows = Array.from({ length: 63 }, (_, i) => row({ id: `n-${i}` }));
    const [batch] = planDigestBatches(rows, 50);
    const { html } = renderDigestEmail(batch, origin);
    expect(html).toContain("13 more");
    // The attribute prefix AND the closing quote are what make this
    // discriminating: the footer's `${origin}/alerts?tab=settings` renders
    // unconditionally, so a bare `toContain(`${origin}/alerts`)` passes even
    // when the truncation link is deleted entirely.
    expect(html).toContain(`href="${origin}/alerts"`);
  });

  it("always links to preferences so every email is one click from off", () => {
    const [batch] = planDigestBatches([row()], 50);
    expect(renderDigestEmail(batch, origin).html).toContain(`${origin}/alerts?tab=settings`);
  });
});

describe("escapeHtml", () => {
  it("neutralises a client name containing markup", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands first so entities are not double-broken", () => {
    expect(escapeHtml("Smith & Sons <LLC>")).toBe("Smith &amp; Sons &lt;LLC&gt;");
  });
});
