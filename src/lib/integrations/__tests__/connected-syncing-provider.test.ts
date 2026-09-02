// src/lib/integrations/__tests__/connected-syncing-provider.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: Array<{ provider: string }> = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: async () => rows }),
    }),
  },
}));

import { getConnectedSyncingProviderId } from "../connections";

const savedAddepar = process.env.ADDEPAR_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADDEPAR_ENABLED = "true";
  rows = [];
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
    if (savedAddepar !== undefined) process.env.ADDEPAR_ENABLED = savedAddepar;
  });
});
