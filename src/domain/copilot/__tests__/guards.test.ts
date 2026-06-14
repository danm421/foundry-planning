// src/domain/copilot/__tests__/guards.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyClientAccess = vi.fn<(clientId: string, firmId: string) => Promise<boolean>>();
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: (c: string, f: string) => verifyClientAccess(c, f) }));

import { assertClientReadable, ForbiddenScopeError } from "../guards";
import type { CopilotAuthContext } from "../state";

const ctx: CopilotAuthContext = {
  userId: "u1",
  firmId: "org_A",
  clientId: "client-in-firm",
  scenarioId: "base",
};

beforeEach(() => verifyClientAccess.mockReset());

describe("assertClientReadable", () => {
  it("invokes verifyClientAccess with the requested client and the ctx firmId", async () => {
    verifyClientAccess.mockResolvedValue(true);
    await assertClientReadable(ctx, "client-in-firm");
    expect(verifyClientAccess).toHaveBeenCalledWith("client-in-firm", "org_A");
  });

  it("throws ForbiddenScopeError for a client the firm cannot access (cross-firm IDOR)", async () => {
    verifyClientAccess.mockResolvedValue(false);
    await expect(assertClientReadable(ctx, "client-in-other-firm")).rejects.toBeInstanceOf(
      ForbiddenScopeError,
    );
    expect(verifyClientAccess).toHaveBeenCalledWith("client-in-other-firm", "org_A");
  });
});
