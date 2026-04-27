import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_test" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm_test"),
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordUpdate: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/lib/audit/snapshots/liability", () => ({
  toLiabilitySnapshot: vi.fn(async (row: { balance: string }) => ({
    name: "Mortgage",
    balance: Number(row.balance),
  })),
  LIABILITY_FIELD_LABELS: {
    balance: { label: "Balance", format: "currency" },
    name: { label: "Name", format: "text" },
  },
}));

// db.select() is called twice: once for client check, once for the before-liability fetch.
// db.update().set().where().returning() returns the updated row.
// db.transaction() is called for the update + optional owners[] write.
vi.mock("@/db", () => {
  let selectCallCount = 0;
  const beforeRow = { id: "lia_test", balance: "300000", name: "Mortgage", clientId: "cli_test" };
  const afterRow = { id: "lia_test", balance: "290000", name: "Mortgage", clientId: "cli_test" };

  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([afterRow]),
      })),
    })),
  }));

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // Client existence check
          return [{ id: "cli_test", firmId: "firm_test" }];
        }
        // Liability before-fetch
        return [beforeRow];
      }),
    })),
  }));

  // transaction() executes the callback with the same tx mock (update only; no owners[] in this test)
  const transaction = vi.fn(async (fn: (tx: object) => Promise<void>) => {
    await fn({ update, select, delete: vi.fn(() => ({ where: vi.fn() })), insert: vi.fn(() => ({ values: vi.fn() })) });
  });

  return {
    db: { select, update, transaction },
  };
});

import { recordUpdate } from "@/lib/audit";
import { PUT } from "../route";

const buildReq = (body: object): Request =>
  new Request("http://localhost/api/clients/cli_test/liabilities/lia_test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.mocked(recordUpdate).mockClear();
});

describe("PUT /api/clients/[id]/liabilities/[liabilityId] — audit shape", () => {
  it("calls recordUpdate with action=liability.update and before/after snapshots", async () => {
    const res = await PUT(buildReq({ balance: 290000 }) as never, {
      params: Promise.resolve({ id: "cli_test", liabilityId: "lia_test" }),
    });

    expect(res.status).toBe(200);
    expect(recordUpdate).toHaveBeenCalledTimes(1);
    expect(recordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "liability.update",
        resourceType: "liability",
        resourceId: "lia_test",
        clientId: "cli_test",
        firmId: "firm_test",
        before: expect.objectContaining({ balance: 300000 }),
        after: expect.objectContaining({ balance: 290000 }),
        fieldLabels: expect.objectContaining({
          balance: { label: "Balance", format: "currency" },
        }),
      }),
    );
  });
});
