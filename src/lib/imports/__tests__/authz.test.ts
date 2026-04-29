import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from "@/db";
import {
  requireImportAccess,
  NotFoundError,
  ForbiddenError,
} from "../authz";

const ARGS = {
  importId: "imp_1",
  clientId: "cli_1",
  firmId: "firm_1",
  userId: "user_1",
};

const IMPORT_ROW = {
  id: "imp_1",
  clientId: "cli_1",
  orgId: "firm_1",
  createdByUserId: "user_1",
  discardedAt: null,
  status: "draft",
};

/**
 * Stage two consecutive db.select() chains: the first resolves to the
 * client lookup, the second to the import lookup. Mirrors the order in
 * requireImportAccess.
 */
function stageSelects(clientResult: unknown[], importResult: unknown[]) {
  const make = (rows: unknown[]) =>
    ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }) as never;
  vi.mocked(db.select)
    .mockReturnValueOnce(make(clientResult))
    .mockReturnValueOnce(make(importResult));
}

beforeEach(() => {
  vi.mocked(db.select).mockReset();
});

describe("requireImportAccess", () => {
  it("returns the import row on success", async () => {
    stageSelects([{ id: "cli_1" }], [IMPORT_ROW]);

    const result = await requireImportAccess(ARGS);

    expect(result).toEqual(IMPORT_ROW);
  });

  it("throws NotFoundError when client does not exist in firm", async () => {
    stageSelects([], [IMPORT_ROW]);

    await expect(requireImportAccess(ARGS)).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Client not found",
    });
  });

  it("throws NotFoundError when import does not belong to client", async () => {
    // Client found, but the import-scoped query returns nothing because
    // the import id is foreign to (clientId, orgId).
    stageSelects([{ id: "cli_1" }], []);

    await expect(requireImportAccess(ARGS)).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Import not found",
    });
  });

  it("throws NotFoundError when import is discarded", async () => {
    // The query in requireImportAccess includes `isNull(discardedAt)`,
    // so a discarded row is filtered server-side and the second select
    // resolves to an empty array — same shape as "not found".
    stageSelects([{ id: "cli_1" }], []);

    await expect(requireImportAccess(ARGS)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws ForbiddenError when createdByUserId does not match caller", async () => {
    stageSelects(
      [{ id: "cli_1" }],
      [{ ...IMPORT_ROW, createdByUserId: "someone_else" }],
    );

    await expect(requireImportAccess(ARGS)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
