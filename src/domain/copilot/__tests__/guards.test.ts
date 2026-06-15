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
  it("resolves when clientId matches the conversation scope and the firm grants access", async () => {
    verifyClientAccess.mockResolvedValue(true);
    await assertClientReadable(ctx, "client-in-firm"); // ctx.clientId === "client-in-firm"
    expect(verifyClientAccess).toHaveBeenCalledWith("client-in-firm", "org_A");
  });
  it("throws ForbiddenScopeError for a clientId outside the conversation scope, before any DB call", async () => {
    await expect(assertClientReadable(ctx, "another-client")).rejects.toBeInstanceOf(ForbiddenScopeError);
    expect(verifyClientAccess).not.toHaveBeenCalled();
  });
  it("throws ForbiddenScopeError when the bound client fails the firm access check (cross-firm IDOR)", async () => {
    verifyClientAccess.mockResolvedValue(false);
    await expect(assertClientReadable(ctx, "client-in-firm")).rejects.toBeInstanceOf(ForbiddenScopeError);
    expect(verifyClientAccess).toHaveBeenCalledWith("client-in-firm", "org_A");
  });
});
