// The `/api/portal/*` gate for the advisor's section switches. Hiding the rail
// entry and 404ing the page leaves the JSON endpoints answering — the section's
// own screens are gone, but a client with the old URL (or a stale mobile build)
// can still fetch the data the advisor removed.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/schema", () => ({ clients: { _name: "clients" } }));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));

let row: Record<string, boolean> | undefined;
const selected: string[] = [];

vi.mock("@/db", () => ({
  db: {
    select: (cols: Record<string, unknown>) => {
      selected.push(Object.keys(cols).join(","));
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve(row ? [row] : []);
      return chain;
    },
  },
}));

import { ForbiddenError } from "@/lib/authz";
import { requirePortalFeature } from "@/lib/portal/load-features";

const ALL_ON = {
  portalInvestmentsEnabled: true,
  portalBudgetEnabled: true,
  portalDocumentsEnabled: true,
  portalCalculatorsEnabled: true,
};

beforeEach(() => {
  selected.length = 0;
  row = { ...ALL_ON };
});

describe("requirePortalFeature", () => {
  it("passes when the switch is on", async () => {
    await expect(requirePortalFeature("c-on", "budget")).resolves.toBeUndefined();
  });

  it("throws ForbiddenError when the switch is off", async () => {
    row = { ...ALL_ON, portalBudgetEnabled: false };
    await expect(requirePortalFeature("c-budget-off", "budget")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  // All three columns are boolean, so a cross-wired projection typechecks clean
  // and would 403 the wrong section. One assertion per key is the only catch.
  it("reads each feature off its own column", async () => {
    row = { ...ALL_ON, portalInvestmentsEnabled: false };
    await expect(requirePortalFeature("c-inv-off", "investments")).rejects.toThrow();
    await expect(requirePortalFeature("c-inv-off-b", "budget")).resolves.toBeUndefined();
    await expect(requirePortalFeature("c-inv-off-d", "documents")).resolves.toBeUndefined();

    row = { ...ALL_ON, portalDocumentsEnabled: false };
    await expect(requirePortalFeature("c-doc-off", "documents")).rejects.toThrow();
    await expect(requirePortalFeature("c-doc-off-i", "investments")).resolves.toBeUndefined();
  });

  // A client row that doesn't resolve is a different failure, caught by the
  // access gate that already ran. Defaulting to "off" here would 403 every
  // section of a portal that is actually fine.
  it("passes when there is no client row", async () => {
    row = undefined;
    await expect(requirePortalFeature("c-missing", "documents")).resolves.toBeUndefined();
  });

  it("carries a message an API client can show", async () => {
    row = { ...ALL_ON, portalDocumentsEnabled: false };
    await expect(requirePortalFeature("c-msg", "documents")).rejects.toThrow(
      /advisor/i,
    );
  });
});
