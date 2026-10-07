// The Home feed's "submitted their intake form" items follow the same book
// rules as the Data Collection queue they link to. Unit test: the query's
// WHERE clause is captured and rendered.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const captured = vi.hoisted(() => ({ where: undefined as unknown, joined: false }));
vi.mock("@/db", () => {
  const chain = {
    from: () => chain,
    leftJoin: () => {
      captured.joined = true;
      return chain;
    },
    where: (w: unknown) => {
      captured.where = w;
      return chain;
    },
    orderBy: () => chain,
    limit: async () => [],
  };
  return { db: { select: () => chain } };
});

const visibleRef = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/visibility", async (orig) => ({
  ...(await orig<typeof import("@/lib/visibility")>()),
  resolveVisibleAdvisorIds: async () => visibleRef.value,
}));

import { fetchIntakeItems } from "../feed-sources";
import { VISIBLE_ALL } from "@/lib/visibility";

const TODAY = new Date(2026, 6, 16);
const rendered = () => new PgDialect().sqlToQuery(captured.where as SQL);

describe("fetchIntakeItems", () => {
  beforeEach(() => {
    captured.joined = false;
  });

  it("narrows a siloed advisor to their own clients' forms and their own prospect forms", async () => {
    visibleRef.value = new Set(["adv-a"]);
    await fetchIntakeItems("firm-1", "adv-a", "org:member", TODAY);
    const { sql } = rendered();
    expect(captured.joined).toBe(true);
    expect(sql).toContain('"clients"."advisor_id"');
    expect(sql).toContain('"intake_forms"."created_by_user_id"');
  });

  it("drops a form bound to a colleague's private client for a non-admin member", async () => {
    visibleRef.value = VISIBLE_ALL;
    await fetchIntakeItems("firm-2", "adv-b", "org:member", TODAY);
    const { sql, params } = rendered();
    expect(sql).toContain('"clients"."is_private"');
    expect(params).toContain("adv-b");
  });

  it("keeps the whole firm for a caller who sees every book", async () => {
    visibleRef.value = VISIBLE_ALL;
    await fetchIntakeItems("firm-3", "user-admin", "org:admin", TODAY);
    const { sql } = rendered();
    expect(sql).not.toContain("advisor_id");
    expect(sql).not.toContain("is_private");
  });
});
