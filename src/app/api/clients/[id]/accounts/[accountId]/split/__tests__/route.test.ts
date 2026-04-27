import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be at top level before any vi.mock() calls
// ---------------------------------------------------------------------------
const mockInsert = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_a" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm_a"),
}));

vi.mock("@/lib/audit", () => ({
  recordCreate: vi.fn().mockResolvedValue(undefined),
  recordDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/audit/snapshots/account", () => ({
  toAccountSnapshot: vi.fn().mockResolvedValue({
    name: "Joint Brokerage",
    value: 100000,
    basis: 60000,
  }),
  ACCOUNT_FIELD_LABELS: {},
}));

// ---------------------------------------------------------------------------
// Shared state for controlling DB responses per test
// ---------------------------------------------------------------------------
type DbState = {
  client: null | { id: string; firmId: string; firstName?: string };
  account: null | {
    id: string;
    clientId: string;
    isDefaultChecking: boolean;
    name: string;
    value: string;
    basis: string;
    category?: string;
    subType?: string;
  };
  // FM owner rows for the account (joint = 2 rows)
  accountOwnerRows: Array<{ familyMemberId: string | null; entityId: string | null }>;
  // Principal FM rows for the client
  familyMemberRows: Array<{ id: string; role: string }>;
  insertedCount: number;
};

const dbState: DbState = {
  client: null,
  account: null,
  accountOwnerRows: [],
  familyMemberRows: [],
  insertedCount: 0,
};

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
    const n = getTableNameSafe(t);
    if (t === schema.clients || n === "clients") return dbState.client ? [dbState.client] : [];
    if (t === schema.accounts || n === "accounts") return dbState.account ? [dbState.account] : [];
    if (t === schema.accountOwners || n === "account_owners") return dbState.accountOwnerRows;
    if (t === schema.familyMembers || n === "family_members") return dbState.familyMemberRows;
    return [];
  };

  const makeResult = (rows: unknown[]) => ({
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    where: (_cond: unknown) => makeResult(rows),
  });

  mockInsert.mockImplementation(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => {
        const id = `acc_new_${dbState.insertedCount++}`;
        return Promise.resolve([{ id }]);
      }),
    })),
  }));

  mockDelete.mockImplementation(() => ({
    where: vi.fn(() => Promise.resolve()),
  }));

  mockTransaction.mockImplementation(
    async (fn: (tx: { insert: typeof mockInsert; delete: typeof mockDelete }) => Promise<unknown>) => {
      return fn({ insert: mockInsert, delete: mockDelete });
    },
  );

  return {
    db: {
      select: (_cols?: unknown) => ({
        from: (t: unknown) => makeResult(rowsFor(t)),
      }),
      transaction: mockTransaction,
    },
  };
});

import { requireOrgId } from "@/lib/db-helpers";
import { recordCreate, recordDelete } from "@/lib/audit";
import { POST } from "../route";

const CLIENT_FM_ID = "fm-client-1";
const SPOUSE_FM_ID = "fm-spouse-1";

function buildReq(body: object): Request {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedJoint(overrides: Partial<DbState["account"]> = {}) {
  dbState.client = { id: "cli_a", firmId: "firm_a", firstName: "Tom" };
  dbState.account = {
    id: "acc_joint",
    clientId: "cli_a",
    isDefaultChecking: false,
    name: "Joint Brokerage",
    value: "100000.00",
    basis: "60000.00",
    category: "taxable",
    subType: "other",
    ...overrides,
  };
  dbState.accountOwnerRows = [
    { familyMemberId: CLIENT_FM_ID, entityId: null },
    { familyMemberId: SPOUSE_FM_ID, entityId: null },
  ];
  dbState.familyMemberRows = [
    { id: CLIENT_FM_ID, role: "client" },
    { id: SPOUSE_FM_ID, role: "spouse" },
  ];
  dbState.insertedCount = 0;
}

beforeEach(() => {
  vi.mocked(requireOrgId).mockResolvedValue("firm_a");
  vi.mocked(recordCreate).mockClear();
  vi.mocked(recordDelete).mockClear();
  mockInsert.mockClear();
  mockDelete.mockClear();
  mockTransaction.mockClear();

  dbState.client = null;
  dbState.account = null;
  dbState.accountOwnerRows = [];
  dbState.familyMemberRows = [];
  dbState.insertedCount = 0;

  mockInsert.mockImplementation(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => {
        const id = `acc_new_${dbState.insertedCount++}`;
        return Promise.resolve([{ id }]);
      }),
    })),
  }));

  mockDelete.mockImplementation(() => ({
    where: vi.fn(() => Promise.resolve()),
  }));

  mockTransaction.mockImplementation(
    async (fn: (tx: { insert: typeof mockInsert; delete: typeof mockDelete }) => Promise<unknown>) => {
      return fn({ insert: mockInsert, delete: mockDelete });
    },
  );
});

describe("POST /api/clients/[id]/accounts/[accountId]/split", () => {
  it("splits a joint account into two wholly-owned accounts and hard-deletes the original", async () => {
    seedJoint();

    const req = buildReq({ clientShare: 0.6 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_a", accountId: "acc_joint" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientAccountId).toBeDefined();
    expect(body.spouseAccountId).toBeDefined();

    // Two inserts (client + spouse accounts) + two accountOwners inserts = 4 total
    // but mocked as one mockInsert fn called multiple times
    expect(mockInsert).toHaveBeenCalled();
    // One delete (original)
    expect(mockDelete).toHaveBeenCalledTimes(1);

    // Audit: 1 delete + 2 creates
    expect(recordDelete).toHaveBeenCalledTimes(1);
    expect(recordCreate).toHaveBeenCalledTimes(2);
  });

  it("rejects non-joint accounts with 400", async () => {
    dbState.client = { id: "cli_a", firmId: "firm_a", firstName: "Tom" };
    dbState.account = {
      id: "acc_client",
      clientId: "cli_a",
      isDefaultChecking: false,
      name: "IRA",
      value: "50000.00",
      basis: "0.00",
    };
    // Only one FM owner row → not joint
    dbState.accountOwnerRows = [{ familyMemberId: CLIENT_FM_ID, entityId: null }];
    dbState.familyMemberRows = [{ id: CLIENT_FM_ID, role: "client" }];
    dbState.insertedCount = 0;

    const req = buildReq({ clientShare: 0.5 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_a", accountId: "acc_client" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Only joint (household) accounts can be split");
  });

  it("rejects splitting the default checking account with 400", async () => {
    seedJoint({ id: "acc_checking", isDefaultChecking: true, name: "Household Cash", value: "25000.00", basis: "0.00" });

    const req = buildReq({ clientShare: 0.5 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_a", accountId: "acc_checking" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("The default household cash account cannot be split");
  });

  it("returns 404 for accounts in another firm", async () => {
    // requireOrgId returns firm_a but client lookup returns empty
    dbState.client = null;
    dbState.account = null;
    dbState.insertedCount = 0;

    const req = buildReq({ clientShare: 0.5 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_b", accountId: "acc_joint" }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Client not found");
  });

  it("rejects life-insurance joint accounts with 400", async () => {
    seedJoint({ id: "acc_li", category: "life_insurance", name: "Joint Life Insurance", value: "250000.00", basis: "0.00" });

    const req = buildReq({ clientShare: 0.5 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_a", accountId: "acc_li" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "Life insurance accounts cannot be split — the policy is tied to the original account.",
    );
  });

  it("preserves the sum invariant on penny-edge values", async () => {
    seedJoint({ id: "acc_joint", value: "99.99", basis: "99.99" });

    // Capture the values objects passed to each insert
    const capturedValues: Array<{ value: string; basis: string }> = [];
    mockInsert.mockImplementation(() => ({
      values: vi.fn((vals: { value?: string; basis?: string }) => {
        if (vals.value !== undefined) capturedValues.push(vals as { value: string; basis: string });
        return {
          returning: vi.fn(() => {
            const id = `acc_new_${dbState.insertedCount++}`;
            return Promise.resolve([{ id }]);
          }),
        };
      }),
    }));

    const req = buildReq({ clientShare: 0.5 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_a", accountId: "acc_joint" }),
    });

    expect(res.status).toBe(200);
    // capturedValues should have 2 account inserts (one for client, one for spouse)
    const acctInserts = capturedValues.filter((v) => v.value !== undefined);
    expect(acctInserts).toHaveLength(2);

    const clientVal = parseFloat(acctInserts[0]!.value);
    const spouseVal = parseFloat(acctInserts[1]!.value);
    const clientBas = parseFloat(acctInserts[0]!.basis);
    const spouseBas = parseFloat(acctInserts[1]!.basis);

    // Sum must equal original exactly — no ±$0.01 drift
    expect(clientVal + spouseVal).toBeCloseTo(99.99, 10);
    expect(clientBas + spouseBas).toBeCloseTo(99.99, 10);
  });
});
