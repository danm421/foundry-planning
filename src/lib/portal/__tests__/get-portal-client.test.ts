import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
vi.mock("@/db", () => ({
  db: { select: () => selectMock() },
}));

import { getPortalClientId } from "@/lib/portal/get-portal-client";

beforeEach(() => selectMock.mockReset());

function mockSelectReturns(rows: Array<{ id: string }>) {
  selectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  });
}

describe("getPortalClientId", () => {
  it("returns clientId when the clerk user is bound", async () => {
    mockSelectReturns([{ id: "client-1" }]);
    const result = await getPortalClientId("user_abc");
    expect(result).toBe("client-1");
  });

  it("returns null when no client row references the user", async () => {
    mockSelectReturns([]);
    const result = await getPortalClientId("user_unknown");
    expect(result).toBeNull();
  });

  it("returns null when given an empty userId", async () => {
    const result = await getPortalClientId("");
    expect(result).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });
});
