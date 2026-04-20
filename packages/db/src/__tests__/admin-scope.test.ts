import { describe, it, expect } from "vitest";
import {
  adminQuery,
  getScopedContext,
  writeAuditLog,
  type AuditInserter,
} from "../admin-scope";
import type { ActingContext } from "@foundry/auth";

const ctx: ActingContext = {
  actorAdminId: "admin-1",
  role: "support",
  impersonation: {
    sessionId: "sess-1",
    advisorClerkUserId: "user_adv",
    firmId: "firm_99",
  },
};

describe("adminQuery", () => {
  it("makes the context readable inside the callback", async () => {
    const seen = await adminQuery(ctx, async () => getScopedContext());
    expect(seen).toEqual(ctx);
  });

  it("returns undefined outside the callback", () => {
    expect(getScopedContext()).toBeUndefined();
  });

  it("propagates the callback return value", async () => {
    const result = await adminQuery(ctx, async () => 42);
    expect(result).toBe(42);
  });

  it("propagates thrown errors", async () => {
    await expect(
      adminQuery(ctx, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("writeAuditLog", () => {
  it("tags the row with actor + impersonation fields", async () => {
    const inserts: Parameters<AuditInserter>[0][] = [];
    const inserter: AuditInserter = async (row) => {
      inserts.push(row);
    };

    await adminQuery(ctx, async () => {
      await writeAuditLog(
        {
          action: "client.update",
          resourceType: "client",
          resourceId: "client-7",
          clientId: "client-7",
          metadata: { before: { x: 1 }, after: { x: 2 } },
        },
        inserter,
      );
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      firmId: "firm_99",
      actorId: "admin-1",
      actingAsAdvisorId: "user_adv",
      impersonationSessionId: "sess-1",
      action: "client.update",
      resourceType: "client",
      resourceId: "client-7",
      clientId: "client-7",
    });
  });

  it("refuses to write when there is no acting context", async () => {
    const inserter: AuditInserter = async () => {};
    await expect(
      writeAuditLog(
        {
          action: "x",
          resourceType: "y",
          resourceId: "z",
        },
        inserter,
      ),
    ).rejects.toThrow(/no acting context/i);
  });

  it("refuses to write when there is no impersonation (admin must be impersonating to touch tenant data)", async () => {
    const inserter: AuditInserter = async () => {};
    const noImp: ActingContext = { ...ctx, impersonation: null };
    await expect(
      adminQuery(noImp, () =>
        writeAuditLog(
          { action: "x", resourceType: "y", resourceId: "z" },
          inserter,
        ),
      ),
    ).rejects.toThrow(/impersonation/i);
  });
});
