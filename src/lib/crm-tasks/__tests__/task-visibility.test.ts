// The CRM task rule: a task with no household is firm-wide, a task assigned to
// the caller is always theirs, and any other task follows its household (the
// book rule plus the Private client rule). Every reader of tasks applies it, so
// a task cannot be listed on one screen while it is refused on another. Unit
// test: `@/db` is a recording double, and each captured WHERE is rendered
// through the real Postgres dialect. Book silo is ON, so a member's book is
// their own households only.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const m = vi.hoisted(() => ({
  wheres: [] as unknown[],
  session: { userId: "", orgId: "", orgRole: "" },
}));

vi.mock("@/db", () => {
  // Every builder method returns the chain, `where` records its argument, and
  // awaiting the chain yields no rows — whatever shape the query has.
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return (resolve: (rows: unknown[]) => void) => resolve([]);
          if (prop === "where") {
            return (w: unknown) => {
              m.wheres.push(w);
              return chain();
            };
          }
          return () => chain();
        },
      },
    );
  const findFirst = async (opts: { where: unknown }) => {
    m.wheres.push(opts.where);
    return undefined;
  };
  return {
    db: {
      select: () => chain(),
      selectDistinct: () => chain(),
      query: { crmTasks: { findFirst }, crmHouseholds: { findFirst, findMany: async () => [] } },
    },
  };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => m.session }));
vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  requireOrgId: async () => m.session.orgId,
}));
vi.mock("@/lib/firm-settings", () => ({ firmBookSiloEnabled: async () => true }));

import { GET as listTasksRoute } from "@/app/api/crm/tasks/route";
import { GET as getTaskRoute } from "@/app/api/crm/tasks/[taskId]/route";
import { requireCrmTaskAccess } from "@/lib/crm/authz";
import { getHomeFeed } from "@/lib/home/feed-sources";
import { getBookKpis } from "@/lib/home/kpis";

const ORG = "org_1";
const TODAY = new Date("2026-10-07T12:00:00Z");
const dialect = new PgDialect();

type Caller = { userId: string; orgRole: string };

// Each surface names the query it reads tasks through (its WHERE's marker).
const surfaces: { name: string; marker: string; run: (caller: Caller) => Promise<unknown> }[] = [
  {
    name: "the Tasks list",
    marker: '"crm_tasks"."firm_id"',
    run: () => listTasksRoute(new NextRequest("http://localhost/api/crm/tasks")),
  },
  {
    name: "the Tasks list narrowed to one household",
    marker: '"crm_tasks"."firm_id"',
    run: () => listTasksRoute(new NextRequest("http://localhost/api/crm/tasks?householdId=hh_other")),
  },
  {
    name: "a task opened by id",
    marker: '"crm_tasks"."id"',
    run: () =>
      getTaskRoute(new NextRequest("http://localhost/api/crm/tasks/t1"), {
        params: Promise.resolve({ taskId: "t1" }),
      }),
  },
  {
    name: "a task's comments, activity and files",
    marker: '"crm_tasks"."id"',
    run: () => requireCrmTaskAccess("t1").catch(() => null),
  },
  {
    name: "the Home feed's mentions",
    marker: '"crm_task_comment_mentions"."mentioned_user_id"',
    run: ({ userId, orgRole }) => getHomeFeed(ORG, userId, orgRole, TODAY),
  },
  {
    name: "the Home tasks-due-this-week count",
    marker: '"crm_tasks"."due_date"',
    run: ({ userId, orgRole }) => getBookKpis(ORG, userId, orgRole, TODAY),
  },
];

function signInAs(userId: string, orgRole: string): Caller {
  m.session = { userId, orgId: ORG, orgRole };
  return { userId, orgRole };
}

function whereWith(marker: string) {
  const rendered = m.wheres
    .filter((w): w is SQL => !!w)
    .map((w) => dialect.sqlToQuery(w))
    .filter((q) => q.sql.includes(marker));
  expect(rendered).toHaveLength(1);
  return rendered[0];
}

beforeEach(() => {
  m.wheres = [];
});

describe.each(surfaces)("$name", ({ marker, run }) => {
  it("keeps a member to household-less tasks, their own, and their book's households", async () => {
    await run(signInAs("adv_me", "org:member"));
    const { sql, params } = whereWith(marker);
    expect(sql).toContain('"crm_tasks"."household_id" is null');
    expect(sql).toContain('"crm_tasks"."assignee_user_id" = $');
    expect(sql).toContain('"crm_households"."advisor_id" in');
    expect(sql).toContain('"clients"."is_private"');
    expect(params).toContain("adv_me");
  });

  it("leaves every task in the firm to a firm admin", async () => {
    await run(signInAs("user_admin", "org:admin"));
    const { sql } = whereWith(marker);
    expect(sql).not.toContain('"crm_households"');
    expect(sql).not.toContain("is_private");
  });
});
