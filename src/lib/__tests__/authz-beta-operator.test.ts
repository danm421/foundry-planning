import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

import { requireBetaOperator } from "../authz";
import { ForbiddenError } from "../authz";
import { UnauthorizedError } from "../db-helpers";

beforeEach(() => vi.clearAllMocks());

describe("requireBetaOperator", () => {
  it("throws UnauthorizedError with no session", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    await expect(requireBetaOperator()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError for a non-operator user", async () => {
    mockAuth.mockResolvedValue({ userId: "user_not_operator" });
    await expect(requireBetaOperator()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolves for an allowlisted operator", async () => {
    mockAuth.mockResolvedValue({ userId: "user_3CNEarpTz0k9nI7gWESXLGMTI7k" });
    await expect(requireBetaOperator()).resolves.toBeUndefined();
  });
});
