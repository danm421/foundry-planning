// src/lib/fact-finder/__tests__/import-lifecycle.test.ts
// Creating and discarding a fact finder import — the cores the imports routes,
// Forge's plan builder and the Claude connector share. None reads a Clerk session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  selectRows: vi.fn(),
  transaction: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: (v: unknown) => ({ returning: async () => [{ id: "imp1", ...(v as object) }] }) }),
    select: () => ({ from: () => ({ where: async () => m.selectRows() }) }),
    transaction: (fn: (tx: unknown) => unknown) => m.transaction(fn),
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => m.recordAudit(...a) }));

import { clientImportFiles, clientImports } from "@/db/schema";
import { NotFoundError } from "@/lib/imports/authz";
import { createFactFinderImport, discardImport } from "../import-lifecycle";
import { emptyFactFinderState } from "../state";

const SCOPE = { importId: "imp1", clientId: "c1", firmId: "org_1" };

/** The discard's transaction: the import UPDATE answers `importRows`, the files UPDATE two rows. Returns the tables it wrote. */
function discardTx(importRows: unknown[]) {
  const updated: unknown[] = [];
  const tx = {
    update: (table: unknown) => {
      updated.push(table);
      const rows = table === clientImports ? importRows : [{ id: "f1" }, { id: "f2" }];
      return { set: () => ({ where: () => ({ returning: async () => rows }) }) };
    },
  };
  m.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  return updated;
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
});

describe("createFactFinderImport", () => {
  it("inserts a draft fact finder import and audits it as the user", async () => {
    const imp = await createFactFinderImport({
      clientId: "c1",
      firmId: "org_1",
      userId: "user_1",
      scenarioId: "sc1",
      mode: "updating",
      notes: "Claude: Accounts",
    });
    expect(imp).toMatchObject({
      id: "imp1",
      clientId: "c1",
      orgId: "org_1",
      scenarioId: "sc1",
      mode: "updating",
      status: "draft",
      createdByUserId: "user_1",
      notes: "Claude: Accounts",
      extractHoldings: true,
      payloadJson: { factFinder: emptyFactFinderState() },
    });
    expect(m.recordAudit).toHaveBeenCalledWith({
      action: "import.created",
      resourceType: "client_import",
      resourceId: "imp1",
      clientId: "c1",
      firmId: "org_1",
      actorId: "user_1",
      metadata: { mode: "updating", scenarioId: "sc1" },
    });
  });

  it("adds the caller's audit metadata, and names an impersonating operator when given one", async () => {
    await createFactFinderImport({
      clientId: "c1",
      firmId: "org_1",
      userId: "user_1",
      scenarioId: null,
      mode: "onboarding",
      actorId: "user_ops",
      audit: { actingAsAdvisor: "user_1" },
    });
    expect(m.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user_ops",
        metadata: { mode: "onboarding", scenarioId: null, actingAsAdvisor: "user_1" },
      }),
    );
  });
});

describe("discardImport", () => {
  it("never discards a committed import: answers saved and changes nothing", async () => {
    m.selectRows.mockResolvedValue([{ status: "committed", discardedAt: null }]);
    expect(await discardImport(SCOPE, "user_1")).toBe("saved");
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it("answers saved when a save lands while the discard waits on the row, and audits nothing", async () => {
    m.selectRows.mockResolvedValue([{ status: "review", discardedAt: null }]);
    const updated = discardTx([]);
    expect(await discardImport(SCOPE, "user_1")).toBe("saved");
    expect(updated).toEqual([clientImports]);
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it("answers already for an import discarded before", async () => {
    m.selectRows.mockResolvedValue([{ status: "discarded", discardedAt: new Date() }]);
    expect(await discardImport(SCOPE)).toBe("already");
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("discards an open import with its files and audits it as the actor", async () => {
    m.selectRows.mockResolvedValue([{ status: "draft", discardedAt: null }]);
    const updated = discardTx([{ id: "imp1" }]);
    expect(await discardImport(SCOPE, "user_1")).toBe("discarded");
    expect(updated).toEqual([clientImports, clientImportFiles]);
    expect(m.recordAudit).toHaveBeenCalledWith({
      action: "import.discarded",
      resourceType: "client_import",
      resourceId: "imp1",
      clientId: "c1",
      firmId: "org_1",
      actorId: "user_1",
      metadata: { fileCountSoftDeleted: 2 },
    });
  });

  it("throws not-found for an import outside the scope", async () => {
    m.selectRows.mockResolvedValue([]);
    await expect(discardImport(SCOPE)).rejects.toBeInstanceOf(NotFoundError);
  });
});
