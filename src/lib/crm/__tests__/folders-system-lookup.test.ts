// Meeting-prep briefs, transcripts and intake uploads are filed by folder name.
// The folder they land in must be an advisor-owned system folder outside the
// "Shared with Client" area: a same-named folder the client made there, or a
// system folder moved there, is never used. Unit test: the folder table is a
// fake that filters by name, which is all a name lookup does.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Folder = {
  id: string;
  name: string;
  parentFolderId: string | null;
  sortOrder: number;
  isSystem: boolean;
  isPortalRoot: boolean;
};

const table = vi.hoisted(() => ({ rows: [] as Folder[] }));
const inserted = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({
  db: {
    query: {
      crmDocumentFolders: {
        findMany: async () => table.rows,
        findFirst: async ({ where }: { where: SQL }) => {
          const params = new PgDialect().sqlToQuery(where).params;
          return table.rows.find((f) => params.includes(f.name));
        },
      },
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted(v);
        return { returning: async () => [{ id: "new-system-folder" }] };
      },
    }),
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => undefined }));

import {
  ensureIntakeFolder,
  ensureMeetingPrepFolder,
  ensureTranscriptsFolder,
  INTAKE_FOLDER_NAME,
  MEETING_PREP_FOLDER_NAME,
} from "../folders";

const sharedRoot: Folder = {
  id: "shared-root",
  name: "Shared with Client",
  parentFolderId: null,
  sortOrder: 0,
  isSystem: true,
  isPortalRoot: true,
};
const folder = (over: Partial<Folder>): Folder => ({
  id: "f",
  name: "",
  parentFolderId: null,
  sortOrder: 0,
  isSystem: true,
  isPortalRoot: false,
  ...over,
});

beforeEach(() => inserted.mockClear());

describe.each([
  ["ensureMeetingPrepFolder", ensureMeetingPrepFolder, MEETING_PREP_FOLDER_NAME],
  ["ensureTranscriptsFolder", ensureTranscriptsFolder, "Transcripts"],
  ["ensureIntakeFolder", ensureIntakeFolder, INTAKE_FOLDER_NAME],
])("%s", (_label, ensure, name) => {
  it("ignores a same-named folder the client made in the shared area", async () => {
    table.rows = [sharedRoot, folder({ id: "planted", name, parentFolderId: "shared-root", isSystem: false })];
    expect(await ensure("hh-1", "firm-1")).toBe("new-system-folder");
    expect(inserted).toHaveBeenCalledWith(expect.objectContaining({ name, isSystem: true }));
  });

  it("ignores a system folder that sits inside the shared area", async () => {
    table.rows = [
      sharedRoot,
      folder({ id: "client-folder", name: "Mine", parentFolderId: "shared-root", isSystem: false }),
      folder({ id: "moved", name, parentFolderId: "client-folder" }),
    ];
    expect(await ensure("hh-1", "firm-1")).toBe("new-system-folder");
  });

  it("reuses the household's own system folder", async () => {
    table.rows = [
      sharedRoot,
      folder({ id: "planted", name, parentFolderId: "shared-root", isSystem: false }),
      folder({ id: "system", name }),
    ];
    expect(await ensure("hh-1", "firm-1")).toBe("system");
    expect(inserted).not.toHaveBeenCalled();
  });
});
