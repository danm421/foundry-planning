import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be at top level before any vi.mock() calls
// ---------------------------------------------------------------------------
const mockInsert = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());

// Shared state for controlling DB responses per test
const dbState = vi.hoisted(() => ({
  client: null as object | null,
  account: null as object | null,
  insertedCount: 0,
}));

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
    owner: "joint",
  }),
  ACCOUNT_FIELD_LABELS: {},
}));

vi.mock("@/db", () => {
  let selectCallIndex = 0;

  mockSelect.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const n = selectCallIndex++;
        if (n === 0) {
          return Promise.resolve(dbState.client ? [dbState.client] : []);
        }
        return Promise.resolve(dbState.account ? [dbState.account] : []);
      }),
    })),
  }));

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
      select: mockSelect,
      transaction: mockTransaction,
    },
  };
});

import { requireOrgId } from "@/lib/db-helpers";
import { recordCreate, recordDelete } from "@/lib/audit";
import { POST } from "../route";

function buildReq(body: object): Request {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(requireOrgId).mockResolvedValue("firm_a");
  vi.mocked(recordCreate).mockClear();
  vi.mocked(recordDelete).mockClear();
  mockInsert.mockClear();
  mockDelete.mockClear();
  mockSelect.mockClear();
  mockTransaction.mockClear();
  dbState.insertedCount = 0;

  // Reset the select call index by re-setting the implementation each test
  let selectCallIndex = 0;
  mockSelect.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const n = selectCallIndex++;
        if (n === 0) {
          return Promise.resolve(dbState.client ? [dbState.client] : []);
        }
        return Promise.resolve(dbState.account ? [dbState.account] : []);
      }),
    })),
  }));

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
    dbState.client = { id: "cli_a", firmId: "firm_a", firstName: "Tom" };
    dbState.account = {
      id: "acc_joint",
      clientId: "cli_a",
      owner: "joint",
      isDefaultChecking: false,
      name: "Joint Brokerage",
      value: "100000.00",
      basis: "60000.00",
      category: "taxable",
      subType: "other",
    };
    dbState.insertedCount = 0;

    const req = buildReq({ clientShare: 0.6 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_a", accountId: "acc_joint" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientAccountId).toBeDefined();
    expect(body.spouseAccountId).toBeDefined();

    // Two inserts (client + spouse accounts)
    expect(mockInsert).toHaveBeenCalledTimes(2);
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
      owner: "client",
      isDefaultChecking: false,
      name: "IRA",
      value: "50000.00",
      basis: "0.00",
    };
    dbState.insertedCount = 0;

    const req = buildReq({ clientShare: 0.5 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_a", accountId: "acc_client" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Only joint accounts can be split");
  });

  it("rejects splitting the default checking account with 400", async () => {
    dbState.client = { id: "cli_a", firmId: "firm_a", firstName: "Tom" };
    dbState.account = {
      id: "acc_checking",
      clientId: "cli_a",
      owner: "joint",
      isDefaultChecking: true,
      name: "Household Cash",
      value: "25000.00",
      basis: "0.00",
    };
    dbState.insertedCount = 0;

    const req = buildReq({ clientShare: 0.5 });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_a", accountId: "acc_checking" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("The default household cash account cannot be split");
  });

  it("returns 404 for accounts in another firm", async () => {
    // requireOrgId returns firm_a but client belongs to firm_b — client lookup returns empty
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
    dbState.client = { id: "cli_a", firmId: "firm_a", firstName: "Tom" };
    dbState.account = {
      id: "acc_li",
      clientId: "cli_a",
      owner: "joint",
      isDefaultChecking: false,
      category: "life_insurance",
      name: "Joint Life Insurance",
      value: "250000.00",
      basis: "0.00",
    };
    dbState.insertedCount = 0;

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
    dbState.client = { id: "cli_a", firmId: "firm_a", firstName: "Tom" };
    dbState.account = {
      id: "acc_joint",
      clientId: "cli_a",
      owner: "joint",
      isDefaultChecking: false,
      category: "taxable",
      name: "Joint Brokerage",
      value: "99.99",
      basis: "99.99",
    };
    dbState.insertedCount = 0;

    // Capture the values objects passed to each insert
    const capturedValues: Array<{ value: string; basis: string }> = [];
    mockInsert.mockImplementation(() => ({
      values: vi.fn((vals: { value: string; basis: string }) => {
        capturedValues.push(vals);
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
    expect(capturedValues).toHaveLength(2);

    const clientVal = parseFloat(capturedValues[0]!.value);
    const spouseVal = parseFloat(capturedValues[1]!.value);
    const clientBas = parseFloat(capturedValues[0]!.basis);
    const spouseBas = parseFloat(capturedValues[1]!.basis);

    // Sum must equal original exactly — no ±$0.01 drift
    expect(clientVal + spouseVal).toBeCloseTo(99.99, 10);
    expect(clientBas + spouseBas).toBeCloseTo(99.99, 10);
  });
});
