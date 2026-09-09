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
 *      standing between a disconnected client and the household they left;
 *   4. and `src/proxy.ts` does not stop at (3) — when it comes back null it
 *      falls through to `claimPortalBinding`, which re-binds from Clerk
 *      metadata nothing ever clears. Link 4 was out of frame in the first
 *      version of this suite, and that is exactly how a Disconnect that got
 *      undone on the very next page load shipped past review.
 *
 * Break any link and Disconnect is a silent no-op: the button succeeds, the row
 * says revoked, and the client keeps full access — via the legacy column (1-3)
 * or via a fresh `active` row the self-heal inserted underneath it (4).
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
import { getTableName } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/** A `portal_bindings` row, already carrying the two columns every read of this
 *  table gets from its `innerJoin` on `clients`. */
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

/** A `clients` row. `clerkUserId` is the LEGACY column — revoking deliberately
 *  never clears it, and `bindClerkUserToClient` reads it. */
type ClientRow = {
  id: string;
  firmId: string;
  advisorId: string;
  clerkUserId: string | null;
};

/** The two tables this suite persists. Reset per test. */
let store: Row[] = [];
let clientStore: ClientRow[] = [];
/** Every table handed to `db.update(...)`, so "revoking never touches
 *  `clients`" is an assertion about the real call, not an assumption. */
let updatedTables: unknown[] = [];

const dialect = new PgDialect();
const COLUMN = /"([a-z_]+)"\."([a-z_]+)"\s*=\s*\$(\d+)/g;
/**
 * Which compiled column belongs to which table, and what it is called on the
 * row objects above. Table-aware ON PURPOSE: `bindClerkUserToClient` reads
 * `clients` by `"clients"."id" = $1`, and a table-blind fake would match that
 * against a BINDING row's id, find nothing, and refuse the bind with
 * `client_not_found` — a pass for entirely the wrong reason.
 */
const COLUMNS: Record<string, Record<string, string>> = {
  portal_bindings: {
    id: "id",
    client_id: "clientId",
    clerk_user_id: "clerkUserId",
    status: "status",
  },
  clients: { id: "id", clerk_user_id: "clerkUserId" },
};

/**
 * Rows of `table` matching a real drizzle condition.
 *
 * Compiles the captured `SQL` with a real `PgDialect` — no database — then
 * pairs each `"table"."column" = $n` in the generated text with its bound
 * parameter to decide which rows match. Only equality predicates on the
 * QUERIED table are read: that is all these modules put in a WHERE, and a
 * predicate naming the joined table narrows nothing here rather than being
 * silently mapped onto the wrong row shape.
 */
function match(cond: unknown, table: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] =
    table === "clients"
      ? (clientStore as unknown as Record<string, unknown>[])
      : (store as unknown as Record<string, unknown>[]);
  if (!cond) return rows;
  const { sql, params } = dialect.sqlToQuery(cond as SQL);
  const wanted: [string, unknown][] = [];
  for (const m of sql.matchAll(COLUMN)) {
    if (m[1] !== table) continue;
    const col = COLUMNS[table]?.[m[2]];
    if (col) wanted.push([col, params[Number(m[3]) - 1]]);
  }
  return rows.filter((r) => wanted.every(([col, val]) => r[col] === val));
}

vi.mock("@/db", () => {
  const chain = () => {
    let table = "portal_bindings";
    let cond: unknown = null;
    let take = Infinity;
    const self = {
      from: (t: unknown) => {
        table = getTableName(t as Parameters<typeof getTableName>[0]);
        return self;
      },
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
        Promise.resolve(match(cond, table).slice(0, take).map((r) => ({ ...r }))).then(
          resolve,
          reject,
        ),
    };
    return self;
  };
  return {
    db: {
      select: () => chain(),
      // `bindClerkUserToClient` awaits `.values(...)` directly — there is no
      // `.returning()` on that call — so this step has to be the thenable.
      insert: (t: unknown) => ({
        values: (vals: Partial<Row>) => {
          if (getTableName(t as Parameters<typeof getTableName>[0]) !== "portal_bindings") {
            throw new Error("this suite only inserts portal_bindings");
          }
          // The join is what supplies firmId/advisorId on every read of this
          // table, so a row inserted here has to pick them up the same way.
          const owner = clientStore.find((c) => c.id === vals.clientId);
          store.push({
            id: `b-new-${store.length + 1}`,
            clientId: String(vals.clientId),
            clerkUserId: String(vals.clerkUserId),
            status: String(vals.status),
            firmId: owner?.firmId ?? "",
            advisorId: owner?.advisorId ?? "",
            acceptedAt: vals.acceptedAt ?? null,
            endedAt: null,
            endedBy: null,
          });
          return Promise.resolve([]);
        },
      }),
      update: (t: unknown) => {
        updatedTables.push(t);
        const table = getTableName(t as Parameters<typeof getTableName>[0]);
        return {
          set: (vals: Record<string, unknown>) => ({
            where: (cond: unknown) => {
              // The legacy dual-write awaits `.where(...)`; every other caller
              // continues to `.returning(...)`. Serve both, applying once.
              const apply = () => {
                const hits = match(cond, table);
                for (const row of hits) Object.assign(row, vals);
                return hits.map((r) => ({ id: r.id }));
              };
              return {
                returning: () => Promise.resolve(apply()),
                then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
                  Promise.resolve().then(apply).then(resolve, reject),
              };
            },
          }),
        };
      },
    },
  };
});

const {
  authMock,
  auditMock,
  notifyMock,
  legacyMock,
  cookieMock,
  householdNamesMock,
  getUserMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  auditMock: vi.fn(),
  notifyMock: vi.fn(),
  legacyMock: vi.fn(),
  cookieMock: vi.fn(),
  householdNamesMock: vi.fn(),
  getUserMock: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  // The self-heal reads the invitation metadata Clerk still carries.
  clerkClient: async () => ({ users: { getUser: getUserMock } }),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: auditMock }));
vi.mock("@/lib/notifications/producers/portal", () => ({ notifyPortalDisconnected: notifyMock }));
vi.mock("@/lib/portal/legacy-binding", () => ({ legacyPortalClientRef: legacyMock }));
vi.mock("next/headers", () => ({ cookies: cookieMock }));
vi.mock("@/lib/portal/household-names", () => ({
  resolveHouseholdNames: householdNamesMock,
  // The route reads this constant from the same module, so the factory has
  // to carry it or the fallback renders `undefined`.
  UNNAMED_HOUSEHOLD: "Your household",
}));

import { DELETE } from "@/app/api/portal/connections/route";
import {
  getPortalClientRef,
  getPortalBindings,
  getPortalClientId,
} from "@/lib/portal/get-portal-client";
import { claimPortalBinding } from "@/lib/portal/claim-portal-binding";
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
  // The households behind those bindings. `clerkUserId` is the LEGACY column,
  // still naming the client after a disconnect exactly as prod does.
  clientStore = [
    { id: "client-1", firmId: "org_a", advisorId: "user_adv", clerkUserId: "user_1" },
    { id: "client-2", firmId: "org_b", advisorId: "user_adv2", clerkUserId: "user_1" },
  ];
  updatedTables = [];
  getUserMock.mockReset();
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

/**
 * The link the Task 10 suite above stopped one short of.
 *
 * Everything above ends at `getPortalClientRef`. `src/proxy.ts` does not: on
 * EVERY org-less request it runs
 *
 *   (await getPortalClientId(userId)) ?? (await claimPortalBinding(userId))
 *
 * and that second half re-binds from the Clerk metadata nothing ever clears.
 * These tests run that exact expression with BOTH real functions and the real
 * `bindClerkUserToClient` against the same store, because a Disconnect that is
 * undone on the next page load is a Disconnect that never happened.
 */
describe("the middleware self-heal and a disconnect", () => {
  /** Mirrors `src/proxy.ts:132`. */
  const resolveLikeProxy = async (userId: string) =>
    (await getPortalClientId(userId)) ?? (await claimPortalBinding(userId));

  it("does not re-bind the household the client just disconnected from", async () => {
    expect((await DELETE(del("client-1"))).status).toBe(200);
    expect(store.map((r) => r.status)).toEqual(["revoked"]);

    // The real post-disconnect Clerk state: the invitation's metadata still
    // names the household, because nothing in the app ever clears it.
    getUserMock.mockResolvedValue({ publicMetadata: { clientId: "client-1" } });

    const resolved = await resolveLikeProxy("user_1");

    // The self-heal really did run and really did reach the bind decision.
    expect(getUserMock).toHaveBeenCalledWith("user_1");
    // One row, still the tombstone. No fresh `active` row underneath it.
    expect(store.map((r) => r.status)).toEqual(["revoked"]);
    expect(resolved).toBeNull();
    expect(store).toHaveLength(1);
    expect(store[0].status).toBe("revoked");
    expect(store.some((r) => r.status === "active")).toBe(false);
    expect(auditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.invite.accepted" }),
    );
  });

  it("still binds a login with NO binding row — the case self-heal exists for", async () => {
    // An invitation whose webhook never arrived: no row in any status. Without
    // this control, "returns null" above could be a bind that never got past
    // the `clients` lookup, and the test would pass against the broken code.
    store = [];
    legacyMock.mockResolvedValue(null);
    getUserMock.mockResolvedValue({ publicMetadata: { clientId: "client-1" } });

    expect(await resolveLikeProxy("user_1")).toBe("client-1");
    expect(store.map((r) => r.status)).toEqual(["active"]);
  });

  it("still binds over a DECLINED row — a refused proposal is not a revoke", async () => {
    // `declined` is only ever written from `pending`: a firm that never had
    // access. Blocking on it would break the path above for anyone who had
    // once turned a different firm down.
    store = [row({ status: "declined", acceptedAt: null })];
    legacyMock.mockResolvedValue(null);
    getUserMock.mockResolvedValue({ publicMetadata: { clientId: "client-1" } });

    expect(await resolveLikeProxy("user_1")).toBe("client-1");
    expect(store.map((r) => r.status)).toEqual(["declined", "active"]);
  });
});
