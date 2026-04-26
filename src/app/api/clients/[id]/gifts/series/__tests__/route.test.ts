import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be at top level before any vi.mock() calls
// ---------------------------------------------------------------------------
const mockInsert = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());

// Shared state for controlling DB responses per test
const dbState = vi.hoisted(() => ({
  client: null as object | null,
  trust: null as object | null,
  planSettings: null as object | null,
  // capturedInsertRows: the array of row objects passed to the single bulk insert call
  capturedInsertRows: [] as Array<{
    clientId: string;
    year: number;
    amount: string;
    grantor: string;
    recipientEntityId: string;
  }>,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_a" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm_a"),
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
        if (n === 1) {
          return Promise.resolve(dbState.trust ? [dbState.trust] : []);
        }
        // n === 2: planSettings
        return Promise.resolve(dbState.planSettings ? [dbState.planSettings] : []);
      }),
    })),
  }));

  mockInsert.mockImplementation(() => ({
    values: vi.fn((rows: Array<{ clientId: string; year: number; amount: string; grantor: string; recipientEntityId: string }>) => {
      dbState.capturedInsertRows = rows;
      return {
        returning: vi.fn(() => {
          return Promise.resolve(rows.map((_, i) => ({ id: `gift_${i}` })));
        }),
      };
    }),
  }));

  mockTransaction.mockImplementation(
    async (fn: (tx: { insert: typeof mockInsert }) => Promise<unknown>) => {
      return fn({ insert: mockInsert });
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
import { POST } from "../route";

function buildReq(body: object): Request {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const TRUST_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const CLIENT_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

beforeEach(() => {
  vi.mocked(requireOrgId).mockResolvedValue("firm_a");
  mockInsert.mockClear();
  mockSelect.mockClear();
  mockTransaction.mockClear();
  dbState.capturedInsertRows = [];

  // Reset the select call index by re-setting the implementation each test
  let selectCallIndex = 0;
  mockSelect.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const n = selectCallIndex++;
        if (n === 0) {
          return Promise.resolve(dbState.client ? [dbState.client] : []);
        }
        if (n === 1) {
          return Promise.resolve(dbState.trust ? [dbState.trust] : []);
        }
        // n === 2: planSettings
        return Promise.resolve(dbState.planSettings ? [dbState.planSettings] : []);
      }),
    })),
  }));

  mockInsert.mockImplementation(() => ({
    values: vi.fn((rows: Array<{ clientId: string; year: number; amount: string; grantor: string; recipientEntityId: string }>) => {
      dbState.capturedInsertRows = rows;
      return {
        returning: vi.fn(() => {
          return Promise.resolve(rows.map((_, i) => ({ id: `gift_${i}` })));
        }),
      };
    }),
  }));

  mockTransaction.mockImplementation(
    async (fn: (tx: { insert: typeof mockInsert }) => Promise<unknown>) => {
      return fn({ insert: mockInsert });
    },
  );

  // Default: valid client + irrevocable trust + planSettings
  dbState.client = { id: CLIENT_ID, firmId: "firm_a" };
  dbState.trust = { id: TRUST_ID, clientId: CLIENT_ID, entityType: "trust", isIrrevocable: true };
  dbState.planSettings = { clientId: CLIENT_ID, inflationRate: "0.03" };
});

describe("POST /api/clients/[id]/gifts/series", () => {
  it("materializes (endYear - startYear + 1) rows with a flat amount when inflationAdjust=false", async () => {
    const req = buildReq({
      grantor: "client",
      recipientEntityId: TRUST_ID,
      startYear: 2026,
      endYear: 2030,
      annualAmount: 18000,
      inflationAdjust: false,
    });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { giftIds: string[] };
    expect(body.giftIds).toHaveLength(5);

    // mockInsert called exactly once with all 5 rows (bulk insert)
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // Verify each year's amount is flat $18000.00
    const rows = dbState.capturedInsertRows;
    expect(rows).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(rows[i]!.year).toBe(2026 + i);
      expect(rows[i]!.amount).toBe("18000.00");
    }
  });

  it("inflation-adjusts amounts when inflationAdjust=true", async () => {
    dbState.planSettings = { clientId: CLIENT_ID, inflationRate: "0.03" };

    const req = buildReq({
      grantor: "client",
      recipientEntityId: TRUST_ID,
      startYear: 2026,
      endYear: 2030,
      annualAmount: 18000,
      inflationAdjust: true,
    });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { giftIds: string[] };
    expect(body.giftIds).toHaveLength(5);

    // mockInsert called exactly once with all 5 rows (bulk insert)
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // Expected amounts with 3% inflation compounded
    const expectedAmounts = [
      (18000 * Math.pow(1.03, 0)).toFixed(2), // "18000.00"
      (18000 * Math.pow(1.03, 1)).toFixed(2), // "18540.00"
      (18000 * Math.pow(1.03, 2)).toFixed(2), // "19096.20"
      (18000 * Math.pow(1.03, 3)).toFixed(2), // "19669.09"
      (18000 * Math.pow(1.03, 4)).toFixed(2), // "20259.16"
    ];

    const rows = dbState.capturedInsertRows;
    expect(rows).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(rows[i]!.year).toBe(2026 + i);
      expect(rows[i]!.amount).toBe(expectedAmounts[i]);
    }
  });

  it("rejects endYear < startYear with 400", async () => {
    const req = buildReq({
      grantor: "client",
      recipientEntityId: TRUST_ID,
      startYear: 2030,
      endYear: 2026,
      annualAmount: 18000,
      inflationAdjust: false,
    });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 for non-irrevocable trust recipientEntityId", async () => {
    // Trust exists but is revocable
    dbState.trust = { id: TRUST_ID, clientId: CLIENT_ID, entityType: "trust", isIrrevocable: false };

    const req = buildReq({
      grantor: "client",
      recipientEntityId: TRUST_ID,
      startYear: 2026,
      endYear: 2030,
      annualAmount: 18000,
      inflationAdjust: false,
    });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Recurring gifts target irrevocable trusts only");
  });
});
