import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared state bucket — tests seed this before calling route handlers
// ---------------------------------------------------------------------------
type DbState = {
  clients: Array<{ id: string; firmId: string }>;
  wills: Array<{ id: string; clientId: string; grantor: string; updatedAt?: Date }>;
  accounts: Array<{ id: string; clientId: string }>;
  familyMembers: Array<{ id: string; clientId: string }>;
  liabilities: Array<{
    id: string;
    clientId: string;
    linkedPropertyId: string | null;
    ownerEntityId: string | null;
  }>;
  willBequests: Array<{
    id: string;
    willId: string;
    kind: string;
    name: string;
    assetMode: string | null;
    accountId: string | null;
    liabilityId: string | null;
    percentage: string;
    condition: string;
    sortOrder: number;
  }>;
  willBequestRecipients: Array<{
    id: string;
    bequestId: string;
    recipientKind: string;
    recipientId: string | null;
    percentage: string;
    sortOrder: number;
  }>;
};

// All IDs must be valid UUIDs for Zod schema validation to pass
const CLIENT_A_ID = "10000000-0000-0000-0000-000000000001";
const CLIENT_B_ID = "10000000-0000-0000-0000-000000000002";
const FIRM_A_ID = "10000000-0000-0000-0000-000000000011";
const FIRM_B_ID = "10000000-0000-0000-0000-000000000012";
const ACCT_A_ID = "10000000-0000-0000-0000-000000000021";
const ACCT_B_ID = "10000000-0000-0000-0000-000000000022";
const FM_A_ID = "10000000-0000-0000-0000-000000000031";
const FM_B_ID = "10000000-0000-0000-0000-000000000032";
const WILL_EXISTING_ID = "10000000-0000-0000-0000-000000000041";

const dbState: DbState = {
  clients: [
    { id: CLIENT_A_ID, firmId: FIRM_A_ID },
    { id: CLIENT_B_ID, firmId: FIRM_B_ID },
  ],
  wills: [],
  accounts: [
    { id: ACCT_A_ID, clientId: CLIENT_A_ID },
    { id: ACCT_B_ID, clientId: CLIENT_B_ID },
  ],
  // Only one family member so the count check (rows.length === requested.size)
  // passes when FM_A_ID is in the request.
  familyMembers: [{ id: FM_A_ID, clientId: CLIENT_A_ID }],
  liabilities: [],
  willBequests: [],
  willBequestRecipients: [],
};

function resetState(overrides: Partial<DbState> = {}) {
  dbState.wills = overrides.wills ?? [];
  dbState.willBequests = overrides.willBequests ?? [];
  dbState.willBequestRecipients = overrides.willBequestRecipients ?? [];
  dbState.liabilities = overrides.liabilities ?? [];
}

vi.mock("@/db", async () => {
  const schema = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");

  function getTableNameSafe(t: unknown): string {
    try {
      return getTableName(t as Parameters<typeof getTableName>[0]);
    } catch {
      return "";
    }
  }

  const rowsFor = (t: unknown): unknown[] => {
    if (t === schema.clients || getTableNameSafe(t) === "clients") return dbState.clients;
    if (t === schema.wills || getTableNameSafe(t) === "wills") return dbState.wills;
    if (t === schema.accounts || getTableNameSafe(t) === "accounts") return dbState.accounts;
    if (t === schema.familyMembers || getTableNameSafe(t) === "family_members")
      return dbState.familyMembers;
    if (t === schema.liabilities || getTableNameSafe(t) === "liabilities")
      return dbState.liabilities;
    if (t === schema.willBequests || getTableNameSafe(t) === "will_bequests")
      return dbState.willBequests;
    if (t === schema.willBequestRecipients || getTableNameSafe(t) === "will_bequest_recipients")
      return dbState.willBequestRecipients;
    return [];
  };

  const makeResult = (rows: unknown[]) => ({
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
    orderBy: () => makeResult(rows),
  });

  // For liability lookups we need to filter by (clientId, id). We do this by
  // storing the current "from" table and applying a filter in where() only for
  // the liabilities table. For all other tables we return all rows (the route's
  // where clauses rely on the mock returning the right rows — the existing
  // pattern for clients/accounts/familyMembers is "return all rows and let the
  // route count them").
  let currentFromTable: unknown = null;

  const db = {
    select: (_cols?: unknown) => ({
      from: (t: unknown) => {
        currentFromTable = t;
        const allRows = rowsFor(t);
        return {
          where: (_cond: unknown) => {
            // For liabilities we need per-row filtering because each lookup is
            // for a specific (clientId, liabilityId) pair. We filter by checking
            // liabilityFilter if set, otherwise return all rows.
            const tableName = getTableNameSafe(t);
            const isLiabTable =
              t === schema.liabilities || tableName === "liabilities";
            const result = isLiabTable && _liabilityWhereId
              ? (allRows as Array<Record<string, unknown>>).filter(
                  (row) => row.id === _liabilityWhereId,
                )
              : allRows;
            currentFromTable = null;
            return makeResult(result);
          },
        };
      },
    }),

    insert: (t: unknown) => ({
      values: (rows: unknown | unknown[]) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        const tableName = getTableNameSafe(t);
        const isWillBequestsTable =
          t === schema.willBequests || tableName === "will_bequests";

        if (isWillBequestsTable) {
          for (const row of arr as Array<Record<string, unknown>>) {
            if (row.kind === "liability" && row.liabilityId) {
              const willId = row.willId as string;
              const liabId = row.liabilityId as string;
              const dup = dbState.willBequests.find(
                (b) => b.willId === willId && b.liabilityId === liabId && b.kind === "liability",
              );
              if (dup) {
                const err = new Error("duplicate key value violates unique constraint");
                (err as unknown as Record<string, unknown>).code = "23505";
                (err as unknown as Record<string, unknown>).constraint =
                  "will_bequests_liability_idx";
                return {
                  returning: () => {
                    throw err;
                  },
                };
              }
              const bId = `b_${Date.now()}_${Math.random()}`;
              dbState.willBequests.push({
                id: bId,
                willId,
                kind: "liability",
                name: (row.name as string) ?? "",
                assetMode: null,
                accountId: null,
                liabilityId: liabId,
                percentage: "100",
                condition: (row.condition as string) ?? "always",
                sortOrder: (row.sortOrder as number) ?? 0,
              });
              return { returning: () => Promise.resolve([{ id: bId }]) };
            }
          }
        }
        return { returning: () => Promise.resolve([{ id: "inserted_new" }]) };
      },
    }),

    delete: (_t: unknown) => ({
      where: () => Promise.resolve(),
    }),

    update: (_t: unknown) => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),

    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => {
      let lastWillId = "w_new";
      const tx = {
        insert: (t: unknown) => ({
          values: (rows: unknown | unknown[]) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            const tableName = getTableNameSafe(t);

            // wills insert
            if (t === schema.wills || tableName === "wills") {
              const row = arr[0] as Record<string, unknown>;
              const willId = `w_${Date.now()}`;
              lastWillId = willId;
              dbState.wills.push({
                id: willId,
                clientId: row.clientId as string,
                grantor: row.grantor as string,
              });
              return { returning: () => Promise.resolve([{ id: willId }]) };
            }

            // willBequests insert
            if (t === schema.willBequests || tableName === "will_bequests") {
              for (const row of arr as Array<Record<string, unknown>>) {
                if (row.kind === "liability" && row.liabilityId) {
                  const willId = (row.willId as string) ?? lastWillId;
                  const liabId = row.liabilityId as string;
                  const dup = dbState.willBequests.find(
                    (b) =>
                      b.willId === willId &&
                      b.liabilityId === liabId &&
                      b.kind === "liability",
                  );
                  if (dup) {
                    const err = new Error("duplicate key value violates unique constraint");
                    (err as unknown as Record<string, unknown>).code = "23505";
                    (err as unknown as Record<string, unknown>).constraint =
                      "will_bequests_liability_idx";
                    throw err;
                  }
                  const bId = `b_${Date.now()}_${Math.random()}`;
                  dbState.willBequests.push({
                    id: bId,
                    willId,
                    kind: "liability",
                    name: (row.name as string) ?? "",
                    assetMode: null,
                    accountId: null,
                    liabilityId: liabId,
                    percentage: "100",
                    condition: (row.condition as string) ?? "always",
                    sortOrder: (row.sortOrder as number) ?? 0,
                  });
                  return { returning: () => Promise.resolve([{ id: bId }]) };
                }
              }
              return { returning: () => Promise.resolve([{ id: "b_new" }]) };
            }

            // anything else (recipients, etc.)
            return { returning: () => Promise.resolve([{ id: "r_new" }]) };
          },
        }),
        delete: (_t: unknown) => ({
          where: () => {
            // Clear willBequests (full-replace pattern in PATCH)
            dbState.willBequests = [];
            return Promise.resolve();
          },
        }),
        update: (_t: unknown) => ({
          set: () => ({
            where: () => Promise.resolve(),
          }),
        }),
      };
      return cb(tx);
    },
  };

  return { db };
});

// Per-test: which liability id should the mock's select → where return?
// Set this before each test that does a liability cross-ref lookup.
let _liabilityWhereId: string | null = null;

// ---------------------------------------------------------------------------
// Existing tests (shape)
// ---------------------------------------------------------------------------

describe("POST /api/clients/[id]/wills (shape)", () => {
  beforeEach(async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockReset();
    _liabilityWhereId = null;
    resetState();
  });

  it("returns 401 when getOrgId throws Unauthorized", async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockRejectedValue(new Error("Unauthorized"));
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ grantor: "client", bequests: [] }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A_ID);
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ grantor: "joint" }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Liability bequest fixtures
// ---------------------------------------------------------------------------

const LIAB_UNLINKED = {
  id: "20000000-0000-0000-0000-000000000001",
  clientId: CLIENT_A_ID,
  linkedPropertyId: null,
  ownerEntityId: null,
};
const LIAB_LINKED = {
  id: "20000000-0000-0000-0000-000000000002",
  clientId: CLIENT_A_ID,
  linkedPropertyId: "20000000-0000-0000-0000-000000000099",
  ownerEntityId: null,
};
const LIAB_ENTITY_OWNED = {
  id: "20000000-0000-0000-0000-000000000003",
  clientId: CLIENT_A_ID,
  linkedPropertyId: null,
  ownerEntityId: "20000000-0000-0000-0000-000000000098",
};

function makeLiabilityBequest(overrides: {
  liabilityId?: string;
  name?: string;
  recipientKind?: string;
  recipientId?: string | null;
}) {
  const recipientKind = overrides.recipientKind ?? "family_member";
  const isSpouse = recipientKind === "spouse";
  return {
    kind: "liability",
    name: overrides.name ?? "Test Mortgage",
    liabilityId: overrides.liabilityId ?? LIAB_UNLINKED.id,
    condition: "always",
    sortOrder: 0,
    recipients: [
      {
        recipientKind,
        recipientId: overrides.recipientId !== undefined
          ? overrides.recipientId
          : isSpouse
            ? null
            : FM_A_ID,
        percentage: 100,
        sortOrder: 0,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Liability bequest tests — POST
// ---------------------------------------------------------------------------

describe("POST /api/clients/[id]/wills — liability bequest validation", () => {
  beforeEach(async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockReset();
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A_ID);
    _liabilityWhereId = null;
    resetState();
  });

  it("accepts a valid liability bequest (unlinked, not entity-owned)", async () => {
    resetState({ liabilities: [LIAB_UNLINKED] });
    _liabilityWhereId = LIAB_UNLINKED.id;

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          grantor: "client",
          bequests: [makeLiabilityBequest({})],
        }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
  });

  it("rejects a liability bequest when liability has linkedPropertyId set", async () => {
    resetState({ liabilities: [LIAB_LINKED] });
    _liabilityWhereId = LIAB_LINKED.id;

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          grantor: "client",
          bequests: [makeLiabilityBequest({ liabilityId: LIAB_LINKED.id })],
        }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("liability_linked_not_bequestable");
  });

  it("rejects a liability bequest when liability has ownerEntityId set", async () => {
    resetState({ liabilities: [LIAB_ENTITY_OWNED] });
    _liabilityWhereId = LIAB_ENTITY_OWNED.id;

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          grantor: "client",
          bequests: [makeLiabilityBequest({ liabilityId: LIAB_ENTITY_OWNED.id })],
        }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("liability_entity_owned_not_bequestable");
  });

  it("rejects a liability bequest when liabilityId does not exist", async () => {
    // No matching liability in state; filter returns empty array
    resetState({ liabilities: [] });
    _liabilityWhereId = "00000000-0000-0000-0000-000000000000";

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          grantor: "client",
          bequests: [
            makeLiabilityBequest({ liabilityId: "00000000-0000-0000-0000-000000000000" }),
          ],
        }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("liability_not_found");
  });

  it("rejects a liability bequest with external_beneficiary recipient (Zod-level)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          grantor: "client",
          bequests: [
            makeLiabilityBequest({
              recipientKind: "external_beneficiary",
              recipientId: FM_A_ID,
            }),
          ],
        }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    // Zod rejects at schema level; error should mention recipient kind
    const issueMessages = JSON.stringify(body.issues ?? body.error ?? "");
    expect(issueMessages.toLowerCase()).toMatch(/recipient/);
  });

  it("rejects a liability bequest with spouse recipient (Zod-level)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          grantor: "client",
          bequests: [
            makeLiabilityBequest({
              recipientKind: "spouse",
              recipientId: null,
            }),
          ],
        }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    const issueMessages = JSON.stringify(body.issues ?? body.error ?? "");
    expect(issueMessages.toLowerCase()).toMatch(/recipient/);
  });

  it("rejects two liability bequests targeting the same liability in one will (duplicate)", async () => {
    resetState({ liabilities: [LIAB_UNLINKED] });
    _liabilityWhereId = LIAB_UNLINKED.id;

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          grantor: "client",
          bequests: [
            makeLiabilityBequest({ name: "Bequest 1" }),
            makeLiabilityBequest({ name: "Bequest 2" }),
          ],
        }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: CLIENT_A_ID }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("duplicate_liability_bequest");
  });
});

// ---------------------------------------------------------------------------
// Liability bequest tests — PATCH round-trip
// ---------------------------------------------------------------------------

describe("PATCH /api/clients/[id]/wills/[willId] — liability bequest round-trip", () => {
  beforeEach(async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockReset();
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A_ID);
    _liabilityWhereId = null;
    resetState({
      wills: [{ id: WILL_EXISTING_ID, clientId: CLIENT_A_ID, grantor: "client" }],
      liabilities: [LIAB_UNLINKED],
    });
  });

  it("PATCH adds a liability bequest and persists it to state", async () => {
    _liabilityWhereId = LIAB_UNLINKED.id;

    const { PATCH } = await import("../[willId]/route");
    const patchRes = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({
          bequests: [makeLiabilityBequest({})],
        }),
      }) as unknown as Parameters<typeof PATCH>[0],
      {
        params: Promise.resolve({ id: CLIENT_A_ID, willId: WILL_EXISTING_ID }),
      } as unknown as Parameters<typeof PATCH>[1],
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody).toHaveProperty("id", WILL_EXISTING_ID);

    // Verify the liability bequest was written to state
    const bequestInState = dbState.willBequests.find(
      (b) => b.kind === "liability" && b.liabilityId === LIAB_UNLINKED.id,
    );
    expect(bequestInState).toBeDefined();
  });
});
