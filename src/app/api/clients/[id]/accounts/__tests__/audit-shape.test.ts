import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_test" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm_test"),
}));

vi.mock("@/lib/db-scoping", () => ({
  assertEntitiesInClient: vi.fn().mockResolvedValue({ ok: true }),
  assertModelPortfoliosInFirm: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordCreate: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/lib/audit/snapshots/account", () => ({
  toAccountSnapshot: vi.fn().mockResolvedValue({
    name: "Joint Brokerage",
    value: 50000,
    basis: 30000,
    owner: "joint",
  }),
  ACCOUNT_FIELD_LABELS: {},
}));

// Mock db: select returns client then scenario; insert -> values -> returning resolves to one row.
vi.mock("@/db", () => {
  let selectCallCount = 0;
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // First select: client lookup in getBaseCaseScenarioId
          return [{ id: "cli_test", firmId: "firm_test" }];
        }
        // Second select: scenario lookup in getBaseCaseScenarioId
        return [{ id: "scn_test", clientId: "cli_test", isBaseCase: true }];
      }),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([
        {
          id: "acc_test",
          name: "Joint Brokerage",
          value: "50000",
          basis: "30000",
          owner: "joint",
          category: "taxable",
        },
      ]),
    })),
  }));
  return {
    db: { select, insert },
  };
});

import { recordCreate } from "@/lib/audit";
import { POST } from "../route";

const buildReq = (body: object): Request =>
  new Request("http://localhost/api/clients/cli_test/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.mocked(recordCreate).mockClear();
});

describe("POST /api/clients/[id]/accounts — audit shape", () => {
  it("calls recordCreate with action=account.create and the snapshot", async () => {
    const req = buildReq({
      name: "Joint Brokerage",
      category: "taxable",
      subType: "other",
      owner: "joint",
      value: 50000,
      basis: 30000,
    });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "cli_test" }),
    });

    expect(res.status).toBe(201);
    expect(recordCreate).toHaveBeenCalledTimes(1);
    expect(recordCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account.create",
        resourceType: "account",
        resourceId: "acc_test",
        clientId: "cli_test",
        firmId: "firm_test",
        snapshot: expect.objectContaining({
          name: "Joint Brokerage",
          value: 50000,
        }),
      }),
    );
  });
});
