// DELETE /api/clients/[id] must erase the client's intake forms: intake_forms.client_id
// is ON DELETE SET NULL, so without an explicit delete the answers, recipient
// details and public link outlive the client. Mocked at the db seam (no database).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const state = vi.hoisted(() => ({
  deletes: [] as Array<{ table: unknown; where: unknown }>,
}));

vi.mock("@/db", () => {
  const tx = {
    delete: (table: unknown) => ({
      where: async (where: unknown) => {
        state.deletes.push({ table, where });
      },
    }),
  };
  return {
    db: {
      ...tx,
      select: () => ({ from: () => ({ where: async () => [] }) }),
      transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    },
  };
});
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn().mockResolvedValue("firm_a") }));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi
    .fn()
    .mockResolvedValue({ client: { id: "client-1" }, firmId: "firm_a", access: "own" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: () => null,
  nullOnAccessDenial: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordDelete: vi.fn(), recordUpdate: vi.fn() }));
vi.mock("@/lib/audit/snapshots/client", () => ({
  toClientSnapshot: () => ({}),
  CLIENT_FIELD_LABELS: {},
}));
vi.mock("@/lib/plaid/revoke", () => ({ revokePlaidTokens: vi.fn() }));

import { DELETE } from "../route";

beforeEach(() => {
  state.deletes = [];
});

describe("DELETE /api/clients/[id] — intake forms", () => {
  it("deletes the client's intake forms within the firm before the client row", async () => {
    const req = new Request("http://test.local", { method: "DELETE" }) as unknown as
      import("next/server").NextRequest;

    const res = await DELETE(req, { params: Promise.resolve({ id: "client-1" }) });
    expect(res.status).toBe(200);

    expect(state.deletes.map((d) => getTableName(d.table as never))).toEqual([
      "intake_forms",
      "clients",
    ]);
    const q = new PgDialect().sqlToQuery(state.deletes[0].where as SQL);
    expect(q.sql).toContain('"intake_forms"."client_id"');
    expect(q.sql).toContain('"intake_forms"."firm_id"');
    expect(q.params).toEqual(expect.arrayContaining(["client-1", "firm_a"]));
  });
});
