import { describe, it, expect, vi, beforeEach } from "vitest";

const selectChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => selectChain() }),
      }),
    }),
  },
}));

import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { ForbiddenError } from "@/lib/authz";

beforeEach(() => selectChain.mockReset());

describe("requireEditEnabled", () => {
  it("resolves when portal_edit_enabled is true", async () => {
    selectChain.mockResolvedValue([{ portalEditEnabled: true }]);
    await expect(requireEditEnabled("c1")).resolves.toBeUndefined();
  });
  it("throws ForbiddenError when portal_edit_enabled is false", async () => {
    selectChain.mockResolvedValue([{ portalEditEnabled: false }]);
    await expect(requireEditEnabled("c1")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
