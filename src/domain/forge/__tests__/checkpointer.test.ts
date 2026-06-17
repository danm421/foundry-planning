// src/domain/copilot/__tests__/checkpointer.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the heavy pg-backed module so the test never touches a real DB.
const fromConnString = vi.fn();
vi.mock("@langchain/langgraph-checkpoint-postgres", () => ({
  PostgresSaver: { fromConnString },
}));

const ORIGINAL_URL = process.env.DATABASE_URL;

describe("getCheckpointer", () => {
  beforeEach(() => {
    vi.resetModules(); // drop the module-level `cached` between cases
    fromConnString.mockReset();
    process.env.DATABASE_URL = "postgres://user:pw@host/db";
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_URL;
  });

  it("returns the same instance on repeated calls (cached singleton)", async () => {
    const sentinel = { __saver: true };
    fromConnString.mockReturnValue(sentinel);
    const { getCheckpointer } = await import("../checkpointer");

    const a = getCheckpointer();
    const b = getCheckpointer();

    expect(a).toBe(b);
    expect(fromConnString).toHaveBeenCalledTimes(1);
    expect(fromConnString).toHaveBeenCalledWith("postgres://user:pw@host/db");
  });

  it("throws when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { getCheckpointer } = await import("../checkpointer");
    expect(() => getCheckpointer()).toThrow("DATABASE_URL is required");
  });
});
