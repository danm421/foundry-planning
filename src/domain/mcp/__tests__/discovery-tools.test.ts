import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";

// vi.hoisted, not a bare top-level const: `vi.mock` factories run during ESM
// import evaluation, before this file's own top-level statements — a plain
// `const searchClients = vi.fn()` referenced inside the mock factory below
// throws "Cannot access before initialization" (TDZ). vi.hoisted() runs
// ahead of the vi.mock calls, so the references are ready in time.
const { searchClients, scanBook } = vi.hoisted(() => ({
  searchClients: vi.fn(),
  scanBook: vi.fn(),
}));

vi.mock("@/lib/client-search", () => ({ searchClients }));
// F9: the three constants below used to be hardcoded literals here, so a
// rename in scan.ts (SIGNAL_KEYS/DEFAULT_LIMIT/MAX_LIMIT) would leave this
// suite green against a vocabulary the real z.enum would reject.
// `importOriginal` pulls the REAL module (including its `@/db` import —
// already proven safe by this exact pattern in
// src/domain/forge/tools/__tests__/book.test.ts) and only `scanBook` itself
// is overridden with the mock.
vi.mock("@/lib/book-scan/scan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/book-scan/scan")>()),
  scanBook,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { discoveryTools } from "../tools/discovery";
import type { McpPrincipal } from "@/lib/mcp/principal";

// tokenSubject deliberately differs from userId: they collide as "user_1" in
// most MCP fixtures, which would let a handler that reads
// `principal.tokenSubject` instead of `principal.userId` pass every case here
// undetected.
const principal: McpPrincipal = {
  userId: "user_1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "sub_1",
};
const byName = (n: string) => discoveryTools.find((t) => t.name === n)!;

beforeEach(() => {
  searchClients.mockReset();
  scanBook.mockReset();
});

describe("search_clients", () => {
  it("returns only id and household title, never contact PII", async () => {
    searchClients.mockResolvedValue([
      { id: "c1", householdTitle: "Mueller", primaryFirstName: "Dan", primaryLastName: "Mueller", primaryEmail: "dan@example.com" },
    ]);
    const out = await byName("search_clients").run({ query: "mue" }, principal);
    // Asserts the whole payload, not just out.households: a leak into a
    // sibling key (e.g. {households: projected, contacts: rows}) or a stray
    // foundryUrl would pass a narrower `out.households`-only assertion.
    expect(out).toEqual({ households: [{ id: "c1", householdTitle: "Mueller" }] });
  });

  it("scopes the search to the token's firm and user", async () => {
    searchClients.mockResolvedValue([]);
    await byName("search_clients").run({ query: "x" }, principal);
    expect(searchClients).toHaveBeenCalledWith("x", "org_1", {
      userId: "user_1",
      orgRole: "org:member",
    });
  });

  // R41 — readOnlyHint alone is unfalsifiable: McpToolAnnotations declares it
  // literal `true`, so no mutation of discovery.ts can move it. Assert the
  // whole annotations object (still pinned by define-tool.test.ts, but worth
  // repeating per-tool) plus a non-empty title, since `title: ""` would slip
  // past every other case here.
  it("carries read-only annotations and a real title", () => {
    const tool = byName("search_clients");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tool.title).toMatch(/\S/);
  });

  // R38.4 — .min(1) dropped from the schema: without it, "" parses fine, the
  // handler forwards it, and this test is the only thing that would notice.
  // F9: `.rejects.toBeTruthy()` passes on ANY rejection — a rate limit, a
  // type error, anything — so it was asserting almost nothing. Tightened to
  // the specific error class AND message, matching this suite's own
  // convention elsewhere of asserting a specific message, not "it threw".
  it("rejects an empty query with a ZodError naming the constraint, instead of forwarding it", async () => {
    searchClients.mockResolvedValue([]);
    const result = byName("search_clients").run({ query: "" }, principal);
    await expect(result).rejects.toBeInstanceOf(ZodError);
    await expect(result).rejects.toThrow(/too small|expected string to have/i);
    expect(searchClients).not.toHaveBeenCalled();
  });

  // R38.5 / R42 — the scope-override proof: a conflicting firmId/userId in
  // the tool ARGS must never reach searchClients. Scope comes only from the
  // token. This guards define-tool.ts:95/114 (schema parse + ctx derivation),
  // not this file — kept per controller ruling even though no mutation
  // confined to discovery.ts alone can redden it independently of the case
  // above.
  it("ignores a conflicting firmId/userId passed as tool arguments — scope comes only from the token", async () => {
    searchClients.mockResolvedValue([]);
    await byName("search_clients").run(
      { query: "x", firmId: "org_ATTACKER", userId: "user_ATTACKER" },
      principal,
    );
    expect(searchClients).toHaveBeenCalledWith("x", "org_1", {
      userId: "user_1",
      orgRole: "org:member",
    });
  });
});

describe("scan_book", () => {
  it("passes the firm and advisor from the token, never from arguments", async () => {
    scanBook.mockResolvedValue({ rows: [], totalCount: 0, truncated: false });
    await byName("scan_book").run({ filters: { cashAtLeast: 100000 } }, principal);
    expect(scanBook).toHaveBeenCalledWith(
      { firmId: "org_1", advisorId: "user_1" },
      expect.objectContaining({ filters: { cashAtLeast: 100000 } }),
    );
  });

  it("caps limit at MAX_LIMIT", async () => {
    scanBook.mockResolvedValue({ rows: [], totalCount: 0, truncated: false });
    await byName("scan_book").run({ limit: 9999 }, principal);
    expect(scanBook.mock.calls[0][1].limit).toBe(200);
  });

  // R38.2 — nothing in the brief's cases pins the default; a narrowed default
  // would still pass every brief case.
  it("defaults limit to DEFAULT_LIMIT when omitted", async () => {
    scanBook.mockResolvedValue({ rows: [], totalCount: 0, truncated: false });
    await byName("scan_book").run({}, principal);
    expect(scanBook.mock.calls[0][1].limit).toBe(25);
  });

  // R38.3 — offset/direction/sortBy passthrough could be swapped for a
  // constant or undefined without any brief case noticing.
  it("passes sortBy, direction and offset through unchanged", async () => {
    scanBook.mockResolvedValue({ rows: [], totalCount: 0, truncated: false });
    await byName("scan_book").run({ sortBy: "netWorth", direction: "asc", offset: 5 }, principal);
    expect(scanBook.mock.calls[0][1]).toEqual(
      expect.objectContaining({ sortBy: "netWorth", direction: "asc", offset: 5 }),
    );
  });

  // R38.1 — the handler returning {} instead of the scanBook result would
  // still satisfy every brief case, since they only assert the mock's inputs.
  it("returns the scanBook result unchanged", async () => {
    const result = {
      rows: [
        {
          clientId: "c9", name: "Doe", netWorth: 1, liquid: 1, cashBalance: 1,
          lastContactDays: null, openTasks: 0, openItems: 0, pendingImport: false,
        },
      ],
      totalCount: 1,
      truncated: false,
    };
    scanBook.mockResolvedValue(result);
    const out = await byName("scan_book").run({}, principal);
    expect(out).toEqual(result);
  });

  // R38.5 / R42 — the scope-override proof for scan_book: a conflicting
  // firmId/advisorId in the tool ARGS must never reach scanBook. This guards
  // define-tool.ts:95/114 (schema parse + ctx derivation), not this file —
  // kept per controller ruling even though no mutation confined to
  // discovery.ts alone can redden it independently of the case above.
  it("ignores a conflicting firmId/advisorId passed as tool arguments — scope comes only from the token", async () => {
    scanBook.mockResolvedValue({ rows: [], totalCount: 0, truncated: false });
    await byName("scan_book").run(
      { filters: { cashAtLeast: 1 }, firmId: "org_ATTACKER", advisorId: "user_ATTACKER" },
      principal,
    );
    expect(scanBook).toHaveBeenCalledWith(
      { firmId: "org_1", advisorId: "user_1" },
      expect.objectContaining({ filters: { cashAtLeast: 1 } }),
    );
  });

  // R41 — see the same-named test in the search_clients block above for why
  // this asserts the full object plus a non-empty title.
  it("carries read-only annotations and a real title", () => {
    const tool = byName("scan_book");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tool.title).toMatch(/\S/);
  });
});
