// Every list and search that applies the advisor book rule also drops a
// colleague's Private client, so a private household cannot be listed on one
// screen while it is refused on another. Firm admins and the client's own
// advisor still see it. Unit test: `@/db` is a recording double, and each
// captured WHERE is rendered through the real Postgres dialect. Book silo is
// OFF, so the book rule alone adds no filter for a member.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, type SQL } from "drizzle-orm";

const m = vi.hoisted(() => ({
  wheres: [] as unknown[],
  rows: [] as unknown[],
  session: { userId: "", orgId: "", orgRole: "" },
}));

vi.mock("@/db", () => {
  // Every builder method returns the chain, `where` records its argument, and
  // awaiting the chain yields `m.rows` — whatever shape the query has.
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return (resolve: (rows: unknown[]) => void) => resolve(m.rows);
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
  return {
    db: {
      select: () => chain(),
      selectDistinct: () => chain(),
      query: {
        crmHouseholds: {
          findMany: async (opts: { where: unknown }) => {
            m.wheres.push(opts.where);
            return [];
          },
        },
      },
    },
  };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => m.session }));
vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  requireOrgId: async () => m.session.orgId,
}));
vi.mock("@/lib/firm-settings", () => ({ firmBookSiloEnabled: async () => false }));
vi.mock("@/lib/clients/shared-access", () => ({
  resolveSharesForRecipient: async () => [],
}));
vi.mock("@/lib/activity/resolve-actors", () => ({ resolveActors: async () => new Map() }));

import { searchClients, findClientRecipient, searchHouseholds } from "../client-search";
import {
  listCrmHouseholds,
  listRecentlyOpenedHouseholds,
  listHouseholdPickerOptions,
} from "../crm/households";
import { visibleHouseholdConditions } from "../home/scope";
import { listRiskProfiles } from "../risk/queries";
import { GET as listClientsRoute } from "@/app/api/clients/route";

const ORG = "org_1";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const dialect = new PgDialect();

type Caller = { userId: string; orgRole: string };

const lists: { name: string; run: (caller: Caller) => Promise<unknown> }[] = [
  { name: "the Clients page", run: () => listCrmHouseholds() },
  {
    name: "the Clients page's recently opened view",
    run: ({ userId }) => {
      m.rows = [{ householdId: "hh1", openedAt: new Date() }];
      return listRecentlyOpenedHouseholds({ userId });
    },
  },
  {
    name: "the task form's household picker",
    run: ({ userId, orgRole }) => listHouseholdPickerOptions(ORG, userId, orgRole),
  },
  {
    name: "client search",
    run: (caller) => {
      m.rows = [{ householdId: "hh1" }];
      return searchClients("smith", ORG, caller);
    },
  },
  {
    name: "the Data Collection recipient lookup",
    run: (caller) => findClientRecipient(CLIENT_ID, ORG, caller),
  },
  { name: "household search", run: (caller) => searchHouseholds("smith", ORG, caller) },
  {
    name: "the Home page feeds",
    run: async ({ userId, orgRole }) => {
      m.wheres.push(and(...(await visibleHouseholdConditions(ORG, userId, orgRole))));
    },
  },
  { name: "the Risk page", run: () => listRiskProfiles() },
  {
    name: "the clients API",
    run: () => listClientsRoute(new NextRequest("http://localhost/api/clients")),
  },
];

function signInAs(userId: string, orgRole: string): Caller {
  m.session = { userId, orgId: ORG, orgRole };
  return { userId, orgRole };
}

// The last captured WHERE belongs to the query whose rows the list returns
// (an earlier one may read the caller's own open history, say).
function lastWhere() {
  expect(m.wheres.length).toBeGreaterThan(0);
  return dialect.sqlToQuery(m.wheres.at(-1) as SQL);
}

beforeEach(() => {
  m.wheres = [];
  m.rows = [];
});

describe.each(lists)("$name", ({ run }) => {
  it("drops a colleague's private client for a non-admin member", async () => {
    await run(signInAs("adv_colleague", "org:member"));
    const { sql, params } = lastWhere();
    expect(sql).toContain('"clients"."is_private"');
    expect(params).toContain("adv_colleague");
  });

  it("keeps every client for a firm admin", async () => {
    await run(signInAs("user_admin", "org:admin"));
    expect(lastWhere().sql).not.toContain("is_private");
  });
});
