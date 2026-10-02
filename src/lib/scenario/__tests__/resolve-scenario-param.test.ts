import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyClientAccess = vi.fn();
let rows: unknown[] = [];
const whereArgs: unknown[] = [];

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: (...a: unknown[]) => verifyClientAccess(...a),
}));
vi.mock("@/db", () => {
  const chain = {
    from: () => chain,
    where: (w: unknown) => {
      whereArgs.push(w);
      return chain;
    },
    limit: () => Promise.resolve(rows),
    then: (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res),
  };
  return { db: { select: () => chain } };
});

import { resolveScenarioId } from "../resolve-scenario-param";

beforeEach(() => {
  verifyClientAccess.mockReset().mockResolvedValue({ ok: true });
  rows = [];
  whereArgs.length = 0;
});

describe("resolveScenarioId", () => {
  it("resolves null and 'base' to the base-case scenario", async () => {
    rows = [{ id: "base-1" }];
    expect(await resolveScenarioId("c1", null)).toBe("base-1");
    expect(await resolveScenarioId("c1", "base")).toBe("base-1");
  });

  it("returns null when the client has no base case", async () => {
    expect(await resolveScenarioId("c1", null)).toBeNull();
  });

  it("throws when the client has two base cases", async () => {
    rows = [{ id: "a" }, { id: "b" }];
    await expect(resolveScenarioId("c1", null)).rejects.toThrow(/Multiple base scenarios/);
  });

  it("returns the requested scenario when it belongs to the client, scoped by client id", async () => {
    rows = [{ id: "s1" }];
    expect(await resolveScenarioId("c1", "s1")).toBe("s1");
    expect(verifyClientAccess).toHaveBeenCalledWith("c1");
    // The WHERE must carry BOTH the scenario id and the client id.
    const { sql, params } = new PgDialect().sqlToQuery(whereArgs[0] as SQL);
    expect(sql).toContain('"scenarios"."id"');
    expect(sql).toContain('"scenarios"."client_id"');
    expect(params).toEqual(["s1", "c1"]);
  });

  it("returns undefined for a scenario that is not this client's", async () => {
    rows = [];
    expect(await resolveScenarioId("c1", "foreign")).toBeUndefined();
  });

  it("returns undefined, reading no scenario, when the caller cannot access the client", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    rows = [{ id: "s1" }];
    expect(await resolveScenarioId("c1", "s1")).toBeUndefined();
    expect(whereArgs).toHaveLength(0);
  });
});
