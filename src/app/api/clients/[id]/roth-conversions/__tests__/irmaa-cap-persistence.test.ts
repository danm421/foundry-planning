import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Task 1 (roth-conversion-irmaa-cap): irmaaCapTier is pure persistence
// plumbing — this round-trips it through the create and update paths of the
// roth-conversions route. The property that matters most is the third one:
// an omitted field must leave the stored cap untouched, while an explicit
// `null` clears it. Collapsing those two into the same thing would mean
// editing a conversion's name silently wipes its IRMAA cap.
//
// Ruling from the controller: this route has no PATCH handler (GET/POST/PUT/
// DELETE only). The brief's "PATCH" step is applied to PUT, which already
// uses the conditional-spread style the brief describes.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

// vi.mock factories below are hoisted above regular top-level statements, so
// the IDs they read eagerly (e.g. via .mockResolvedValue(FIRM_ID)) must come
// from vi.hoisted(), not a plain `const` declared later in this file.
const { CLIENT_ID, FIRM_ID, SCENARIO_ID, DEST_ACCOUNT_ID, SOURCE_ACCOUNT_ID, ROTH_CONVERSION_ID } =
  vi.hoisted(() => ({
    CLIENT_ID: "00000000-0000-4000-8000-000000000001",
    FIRM_ID: "00000000-0000-4000-8000-000000000099",
    SCENARIO_ID: "11111111-1111-4111-8111-111111111111",
    DEST_ACCOUNT_ID: "22222222-2222-4222-8222-222222222222",
    SOURCE_ACCOUNT_ID: "33333333-3333-4333-8333-333333333333",
    ROTH_CONVERSION_ID: "44444444-4444-4444-8444-444444444444",
  }));

const insertedRothValues: Row[] = [];
const updateSets: Row[] = [];
let beforeRow: Row[] = [];

vi.mock("@/db", async () => {
  const schema = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === schema.scenarios) return [{ id: SCENARIO_ID, isBaseCase: true }];
          if (table === schema.rothConversions) return beforeRow;
          if (table === schema.rothConversionSources) return [];
          return [];
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (rows: Row | Row[]) => ({
        returning: async () => {
          if (table === schema.rothConversions) {
            const row = rows as Row;
            insertedRothValues.push(row);
            return [{ id: ROTH_CONVERSION_ID, ...row }];
          }
          return Array.isArray(rows) ? rows : [rows];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (vals: Row) => ({
        where: () => ({
          returning: async () => {
            if (table === schema.rothConversions) {
              updateSets.push(vals);
              return [{ id: ROTH_CONVERSION_ID, ...beforeRow[0], ...vals }];
            }
            return [];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => {} }),
  };
  return { db };
});

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue(FIRM_ID) };
});
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true }),
  requireClientEditAccess: vi.fn().mockResolvedValue({
    client: { id: CLIENT_ID },
    firmId: FIRM_ID,
    access: "own",
  }),
}));
vi.mock("@/lib/db-scoping", () => ({
  assertAccountsInClient: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/audit", () => ({
  recordCreate: vi.fn().mockResolvedValue(undefined),
  recordUpdate: vi.fn().mockResolvedValue(undefined),
  recordDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit/snapshots/roth-conversion", () => ({
  toRothConversionSnapshot: vi.fn().mockResolvedValue({}),
  ROTH_CONVERSION_FIELD_LABELS: {},
}));
vi.mock("@/lib/clients/cross-firm-audit", () => ({
  crossFirmAuditMeta: vi.fn().mockReturnValue({}),
}));

import { POST, PUT } from "../route";

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

function req(method: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/clients/${CLIENT_ID}/roth-conversions`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const validConversion = {
  name: "Fill 22% bracket",
  destinationAccountId: DEST_ACCOUNT_ID,
  sourceAccountIds: [SOURCE_ACCOUNT_ID],
  conversionType: "fixed_amount",
  fixedAmount: 10000,
  startYear: 2026,
  indexingRate: 0,
};

beforeEach(() => {
  insertedRothValues.length = 0;
  updateSets.length = 0;
  beforeRow = [
    {
      id: ROTH_CONVERSION_ID,
      clientId: CLIENT_ID,
      scenarioId: SCENARIO_ID,
      name: "Existing conversion",
      destinationAccountId: DEST_ACCOUNT_ID,
      conversionType: "fixed_amount",
      fixedAmount: "10000",
      fillUpBracket: null,
      irmaaCapTier: 2,
      startYear: 2026,
      startYearRef: null,
      endYear: null,
      endYearRef: null,
      indexingRate: "0",
      inflationStartYear: null,
    },
  ];
});

describe("roth-conversions irmaaCapTier persistence", () => {
  it("stores irmaaCapTier on create", async () => {
    const res = await POST(req("POST", { ...validConversion, irmaaCapTier: 1 }), ctx as never);
    expect(res.status).toBe(201);
    expect(insertedRothValues).toHaveLength(1);
    expect(insertedRothValues[0]).toMatchObject({ irmaaCapTier: 1 });
  });

  it("defaults irmaaCapTier to null when omitted on create", async () => {
    const res = await POST(req("POST", validConversion), ctx as never);
    expect(res.status).toBe(201);
    expect(insertedRothValues).toHaveLength(1);
    expect(insertedRothValues[0]).toMatchObject({ irmaaCapTier: null });
  });

  it("clears irmaaCapTier when PUT with explicit null; leaves it alone when omitted", async () => {
    const clearRes = await PUT(
      req("PUT", { rothConversionId: ROTH_CONVERSION_ID, irmaaCapTier: null }),
      ctx as never,
    );
    expect(clearRes.status).toBe(200);
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toHaveProperty("irmaaCapTier", null);

    updateSets.length = 0;
    const omitRes = await PUT(
      req("PUT", { rothConversionId: ROTH_CONVERSION_ID, name: "Renamed" }),
      ctx as never,
    );
    expect(omitRes.status).toBe(200);
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).not.toHaveProperty("irmaaCapTier");
  });
});
