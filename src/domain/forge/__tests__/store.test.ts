import { describe, it, expect, afterEach } from "vitest";

describe("getStore", () => {
  const saved = process.env.DATABASE_URL;
  afterEach(() => {
    process.env.DATABASE_URL = saved;
  });

  it("throws when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { getStore } = await import("../store");
    expect(() => getStore()).toThrow(/DATABASE_URL/);
  });

  it("returns the same instance on repeated calls", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    const { getStore } = await import("../store");
    expect(getStore()).toBe(getStore());
  });
});
