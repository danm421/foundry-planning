// A client can't create or rename a portal folder to a name the advisor side
// files internal documents into ("Meeting Prep", "Transcripts", "Intake
// Documents"), in any letter case. Other names are fine. Unit test: the portal
// context and database are faked.
import { describe, it, expect, vi, beforeEach } from "vitest";

const writes = vi.hoisted(() => vi.fn());
const folderRow = { id: "f1", name: "Old", parentFolderId: "root", sortOrder: 0, householdId: "hh-1" };

vi.mock("@/db", () => {
  const update = () => ({
    set: (v: unknown) => {
      writes(v);
      return { where: () => ({ returning: async () => [folderRow] }) };
    },
  });
  return {
    db: {
      query: { crmDocumentFolders: { findFirst: async () => folderRow } },
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          writes(v);
          return { returning: async () => [{ ...folderRow, ...v, id: "new" }] };
        },
      }),
      transaction: async (fn: (tx: unknown) => unknown) => fn({ update }),
    },
  };
});
vi.mock("../vault-context", async (orig) => ({
  ...(await orig<typeof import("../vault-context")>()),
  resolvePortalVaultContext: async () => ({
    householdId: "hh-1",
    firmId: "firm-1",
    clientId: "client-1",
    sharedRootId: "root",
    subtree: new Set(["root", "f1"]),
    mode: "client",
  }),
}));
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: async () => undefined,
  recordUpdate: async () => undefined,
  recordDelete: async () => undefined,
}));

import { createPortalFolder, updatePortalFolder } from "../vault-folders";

beforeEach(() => writes.mockClear());

describe("portal folder names", () => {
  it.each(["Meeting Prep", "transcripts", "  INTAKE DOCUMENTS "])("refuses to create %j", async (name) => {
    await expect(createPortalFolder({ name, parentFolderId: null })).rejects.toThrow(/reserved/i);
    expect(writes).not.toHaveBeenCalled();
  });

  it("refuses to rename a folder to a reserved name", async () => {
    await expect(updatePortalFolder("f1", { name: "Meeting Prep" })).rejects.toThrow(/reserved/i);
    expect(writes).not.toHaveBeenCalled();
  });

  it("creates and renames folders with ordinary names", async () => {
    await expect(createPortalFolder({ name: "Tax", parentFolderId: null })).resolves.toMatchObject({ name: "Tax" });
    await expect(updatePortalFolder("f1", { name: "Insurance" })).resolves.toBeDefined();
  });
});
