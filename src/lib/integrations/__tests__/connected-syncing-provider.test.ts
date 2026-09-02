// src/lib/integrations/__tests__/connected-syncing-provider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

let rows: Array<{ provider: string }> = [];
// Captures the real drizzle condition the helper builds, so the "scopes to
// the firm" test below can inspect the actual SQL/params rather than a
// mock that discards its argument (the failure mode: a helper that dropped
// `eq(firmId)` would return every firm's connected providers and still
// pass every OTHER test in this file, because none of them assert on the
// condition itself).
let capturedWhere: unknown = null;
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async (cond: unknown) => {
          capturedWhere = cond;
          return rows;
        },
      }),
    }),
  },
}));

import { getConnectedSyncingProviderId } from "../connections";

// `@/db` is mocked but drizzle-orm and the schema are real, so `capturedWhere`
// is the actual SQL condition object the helper's `and(eq(...), eq(...))`
// built — same idiom as `src/lib/presentations/story/__tests__/repo.test.ts`.
const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as never);

const savedAddepar = process.env.ADDEPAR_ENABLED;
const savedAzure = process.env.AZURE_BYOK_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADDEPAR_ENABLED = "true";
  // Must be "true" for the credentials-only test below to exercise `def.syncs`
  // specifically: with the kill switch left off, azure_openai fails on
  // `isEnabled()` alone and the test can't tell a dropped `syncs` check from
  // a dropped `isEnabled()` check.
  process.env.AZURE_BYOK_ENABLED = "true";
  rows = [];
  capturedWhere = null;
});

afterEach(() => {
  if (savedAddepar === undefined) delete process.env.ADDEPAR_ENABLED;
  else process.env.ADDEPAR_ENABLED = savedAddepar;
  if (savedAzure === undefined) delete process.env.AZURE_BYOK_ENABLED;
  else process.env.AZURE_BYOK_ENABLED = savedAzure;
});

describe("getConnectedSyncingProviderId", () => {
  it("returns null when the firm has no connections", async () => {
    expect(await getConnectedSyncingProviderId("firm_1")).toBeNull();
  });

  it("returns a connected, enabled, syncing provider", async () => {
    rows = [{ provider: "addepar" }];
    expect(await getConnectedSyncingProviderId("firm_1")).toBe("addepar");
  });

  it("ignores a credentials-only provider (azure_openai does not sync)", async () => {
    rows = [{ provider: "azure_openai" }];
    expect(await getConnectedSyncingProviderId("firm_1")).toBeNull();
  });

  it("ignores a provider whose kill-switch is off", async () => {
    delete process.env.ADDEPAR_ENABLED;
    rows = [{ provider: "addepar" }];
    expect(await getConnectedSyncingProviderId("firm_1")).toBeNull();
  });

  it("scopes the query to the firm and to connected status", async () => {
    await getConnectedSyncingProviderId("firm_9");
    const { sql, params } = render(capturedWhere);
    expect(sql).toContain("firm_id");
    expect(sql).toContain("status");
    expect(params).toEqual(["firm_9", "connected"]);
  });
});
