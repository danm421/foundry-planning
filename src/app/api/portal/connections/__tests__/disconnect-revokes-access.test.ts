/**
 * The chain nobody has ever run.
 *
 * `revokeBinding` had ZERO non-test callers until this route, so "Disconnect
 * actually removes access" was a claim assembled from three separately-tested
 * parts and never once exercised end to end:
 *
 *   1. DELETE /api/portal/connections calls `revokeBinding`;
 *   2. `revokeBinding` writes a `revoked` row and DELIBERATELY does not clear
 *      `clients.clerk_user_id` — Deploy 1's legacy fallback still needs that
 *      column for other logins;
 *   3. `getPortalClientRef` refuses the legacy fallback for a login holding any
 *      `active` or `revoked` row, so the tombstone from (2) is the ONLY thing
 *      standing between a disconnected client and the household they left.
 *
 * Break any link and Disconnect is a silent no-op: the button succeeds, the row
 * says revoked, and the client keeps full access via the legacy column.
 *
 * So this suite mocks the DATABASE, not the modules under test. The route, the
 * real `revokeBinding`, the real `listBindingsForUser` and the real
 * `getPortalClientRef` all run against one shared in-memory `portal_bindings`
 * store, and the fake compiles each query's REAL drizzle predicate with a real
 * `PgDialect` to decide which rows it matches — so a WHERE clause that stopped
 * scoping by `clerkUserId`, or an UPDATE that stopped writing `revoked`, fails
 * here rather than passing against a hand-written stub.
 *
 * `legacyPortalClientRef` is mocked to KEEP RETURNING the household, which is
 * the whole point: that is what the un-cleared legacy column does on prod
 * during Deploy 1.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Row = {
  id: string;
  clientId: string;
  clerkUserId: string;
  status: string;
  firmId: string;
  advisorId: string;
  acceptedAt: Date | null;
  endedAt: Date | null;
  endedBy: string | null;
};

/** The one table this suite persists. Reset per test. */
let store: Row[] = [];
/** Every table handed to `db.update(...)`, so "revoking never touches
 *  `clients`" is an assertion about the real call, not an assumption. */
let updatedTables: unknown[] = [];

const dialect = new PgDialect();
const COLUMN = /"[a-z_]+"\."([a-z_]+)"\s*=\s*\$(\d+)/g;
const CAMEL: Record<string, keyof Row> = {
  id: "id",
  client_id: "clientId",
  clerk_user_id: "clerkUserId",
  status: "status",
};

/**
 * Rows matching a real drizzle condition.
 *
 * Compiles the captured `SQL` with a real `PgDialect` — no database — then
 * pairs each `"table"."column" = $n` in the generated text with its bound
 * parameter. Only equality predicates are read, which is all `bindings.ts`
 * uses on this table; an `inArray`/`or` would simply not narrow, so nothing
 * here can silently over-match a row into a pass.
 */
function match(cond: unknown): Row[] {
  if (!cond) return store;
  const { sql, params } = dialect.sqlToQuery(cond as SQL);
  const wanted: [keyof Row, unknown][] = [];
  for (const m of sql.matchAll(COLUMN)) {
    const col = CAMEL[m[1]];
    if (col) wanted.push([col, params[Number(m[2]) - 1]]);
  }
  return store.filter((r) => wanted.every(([col, val]) => r[col] === val));
}

vi.mock("@/db", () => {
  const chain = () => {
    let cond: unknown = null;
    let take = Infinity;
    const self = {
      from: () => self,
      innerJoin: () => self,
      where: (c: unknown) => {
        cond = c;
        return self;
      },
      orderBy: () => self,
      limit: (n: number) => {
        take = n;
        return self;
      },
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(match(cond).slice(0, take).map((r) => ({ ...r }))).then(resolve, reject),
    };
    return self;
  };
  return {
    db: {
      select: () => chain(),
      update: (table: unknown) => {
        updatedTables.push(table);
        return {
          set: (vals: Partial<Row>) => ({
            where: (cond: unknown) => ({
              returning: () => {
                const hits = match(cond);
                for (const row of hits) Object.assign(row, vals);
                return Promise.resolve(hits.map((r) => ({ id: r.id })));
              },
            }),
          }),
        };
      },
    },
  };
});

const { authMock, auditMock, notifyMock, legacyMock, cookieMock, householdNamesMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    auditMock: vi.fn(),
    notifyMock: vi.fn(),
    legacyMock: vi.fn(),
    cookieMock: vi.fn(),
    householdNamesMock: vi.fn(),
  }),
);
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock, clerkClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: auditMock }));
vi.mock("@/lib/notifications/producers/portal", () => ({ notifyPortalDisconnected: notifyMock }));
vi.mock("@/lib/portal/legacy-binding", () => ({ legacyPortalClientRef: legacyMock }));
vi.mock("next/headers", () => ({ cookies: cookieMock }));
vi.mock("@/lib/portal/household-names", () => ({ resolveHouseholdNames: householdNamesMock }));

import { DELETE } from "@/app/api/portal/connections/route";
import { getPortalClientRef, getPortalBindings } from "@/lib/portal/get-portal-client";
import { portalBindings, clients } from "@/db/schema";

const del = (clientId: string) =>
  new Request("http://x/api/portal/connections", {
    method: "DELETE",
    body: JSON.stringify({ clientId }),
  });

function row(over: Partial<Row> = {}): Row {
  return {
    id: "b1",
    clientId: "client-1",
    clerkUserId: "user_1",
    status: "active",
    firmId: "org_a",
    advisorId: "user_adv",
    acceptedAt: new Date("2026-03-04T09:00:00Z"),
    endedAt: null,
    endedBy: null,
    ...over,
  };
}

beforeEach(() => {
  store = [row()];
  updatedTables = [];
  authMock.mockReset();
  auditMock.mockReset();
  notifyMock.mockReset();
  legacyMock.mockReset();
  cookieMock.mockReset();
  householdNamesMock.mockReset();

  authMock.mockResolvedValue({ userId: "user_1", orgId: null });
  auditMock.mockResolvedValue(undefined);
  notifyMock.mockResolvedValue(undefined);
  householdNamesMock.mockResolvedValue(new Map());
  cookieMock.mockResolvedValue({ get: () => undefined });
  // Deploy 1 still writes `clients.clerk_user_id` and revoking deliberately
  // does not clear it. Modelling that faithfully is what makes this suite
  // able to catch a Disconnect that only LOOKS like it worked.
  legacyMock.mockResolvedValue({ id: "client-1", firmId: "org_a", advisorId: "user_adv" });
});

describe("Disconnect actually removes access", () => {
  it("hands the household over before the disconnect", async () => {
    // The control. Without it, "returns null afterwards" could be a resolver
    // that never returned anything in this harness at all.
    expect(await getPortalClientRef("user_1")).toEqual({
      id: "client-1",
      firmId: "org_a",
      advisorId: "user_adv",
    });
  });

  it("leaves the login unable to reach the household it just left", async () => {
    expect((await getPortalClientRef("user_1"))?.id).toBe("client-1");

    const res = await DELETE(del("client-1"));
    expect(res.status).toBe(200);

    // The tombstone the whole chain depends on.
    expect(store[0].status).toBe("revoked");
    expect(store[0].endedBy).toBe("client");
    expect(store[0].endedAt).toBeInstanceOf(Date);

    // The legacy column still names them — and the resolver refuses anyway.
    expect(await legacyMock()).toEqual({
      id: "client-1",
      firmId: "org_a",
      advisorId: "user_adv",
    });
    expect(await getPortalClientRef("user_1")).toBeNull();
    expect(await getPortalBindings("user_1")).toEqual([]);
  });

  it("never clears the legacy column it depends on other logins still having", async () => {
    await DELETE(del("client-1"));
    // `clients` is joined for its firmId, never written. Writing it here would
    // strand every OTHER mid-deploy client whose backfill row went missing.
    expect(updatedTables).toEqual([portalBindings]);
    expect(updatedTables).not.toContain(clients);
  });

  it("audits the disconnect as the CLIENT's act", async () => {
    await DELETE(del("client-1"));
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.access.revoked_by_client",
        clientId: "client-1",
        firmId: "org_a",
        actorId: "user_1",
        actorKind: "client",
      }),
    );
  });

  it("leaves the client's OTHER firm untouched", async () => {
    // The reason this feature exists: one login, several firms. Leaving one
    // must not evict the client from the rest.
    store = [
      row(),
      row({
        id: "b2",
        clientId: "client-2",
        firmId: "org_b",
        advisorId: "user_adv2",
        acceptedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ];

    expect((await DELETE(del("client-1"))).status).toBe(200);

    expect(store.map((r) => r.status)).toEqual(["revoked", "active"]);
    expect((await getPortalBindings("user_1")).map((b) => b.clientId)).toEqual(["client-2"]);
    expect(await getPortalClientRef("user_1")).toEqual({
      id: "client-2",
      firmId: "org_b",
      advisorId: "user_adv2",
    });
  });

  it("cannot revoke a household belonging to a DIFFERENT login", async () => {
    // The store holds someone else's active binding for the same household.
    store = [row({ id: "b-other", clerkUserId: "user_other" })];
    const res = await DELETE(del("client-1"));
    expect(res.status).toBe(404);
    expect(store[0].status).toBe("active");
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
