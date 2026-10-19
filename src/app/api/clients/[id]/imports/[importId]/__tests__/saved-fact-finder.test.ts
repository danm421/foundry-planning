// src/app/api/clients/[id]/imports/[importId]/__tests__/saved-fact-finder.test.ts
//
// A fact finder saved to the plan keeps its closed record and change list in
// `payload_json` (Plan 4, Review Focus 5). The legacy routes that write an
// import's payload or status, and have no route test of their own, refuse one
// before doing any work: matching (which replaces the whole payload) and
// committing tabs; discarding refuses every committed import, as it always
// did. A fact finder import that is still open (or a statement-chat one) gets
// the fact finder message instead; a Review Wizard import goes through as
// before Plan 4.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/imports/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/authz")>("@/lib/imports/authz");
  return { ...actual, requireImportAccess: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/imports/run-matching", () => ({ runImportMatching: vi.fn() }));
vi.mock("@/lib/imports/commit/orchestrator", () => ({ commitTabs: vi.fn() }));
vi.mock("@/lib/imports/commit/holdings", () => ({ resolveHoldingsForCommit: vi.fn() }));
vi.mock("@/lib/investments/sync-account-from-holdings", () => ({ syncAccountFromHoldings: vi.fn() }));
vi.mock("@/lib/crm/vault-plans", () => ({ linkImportFilesToVault: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: vi.fn(), update: vi.fn(), transaction: vi.fn() } }));

import { POST as commit } from "../commit/route";
import { POST as discard } from "../discard/route";
import { POST as match } from "../match/route";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImportFiles, clientImports } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";
import { FACT_FINDER_ONLY_MESSAGE } from "@/lib/imports/saved-fact-finder";
import { requireImportAccess } from "@/lib/imports/authz";
import { commitTabs } from "@/lib/imports/commit/orchestrator";
import { runImportMatching } from "@/lib/imports/run-matching";
import { checkImportRateLimit } from "@/lib/rate-limit";

/** A fact finder saved to the plan — committed, its closed record in the payload — that also carries what a legacy run would act on. */
const SAVED_IMPORT = {
  id: "i1",
  status: "committed",
  createdByUserId: "user_1",
  mode: "onboarding",
  scenarioId: "sc1",
  discardedAt: null,
  payloadJson: {
    factFinder: { version: 3, closed: { at: "2026-10-16T09:00:00.000Z" } },
    fileResults: { f1: { warnings: [] } },
    payload: { accounts: [] },
  },
};

const req = (path: string, body: unknown = {}) =>
  new Request(`https://app.foundryplanning.com/api/clients/c1/imports/i1/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

/** The discard's own read of the import it is about to discard. */
const discardReads = (imp: unknown) =>
  vi.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: async () => [imp] }) } as never);

/** A Review Wizard import finished with "Commit": committed, and no fact finder in its payload. */
const FINISHED_WIZARD_IMPORT = { ...SAVED_IMPORT, payloadJson: { fileResults: { f1: { warnings: [] } }, payload: { accounts: [] } } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(requireImportAccess).mockResolvedValue(SAVED_IMPORT as never);
  vi.mocked(runImportMatching).mockResolvedValue({ exact: 0, fuzzy: 0, new: 0 });
  vi.mocked(commitTabs).mockResolvedValue({ results: {}, allTabsCommitted: true } as never);
});

describe("a fact finder saved to the plan is refused before any work", () => {
  it("match — which would replace the whole payload", async () => {
    const res = await match(req("match"), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SAVE_CLOSED_MESSAGE });
    expect(runImportMatching).not.toHaveBeenCalled();
  });

  it("commit", async () => {
    const res = await commit(req("commit", { tabs: ["goals"] }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SAVE_CLOSED_MESSAGE });
    expect(commitTabs).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("discard — with the refusal every committed import gets", async () => {
    discardReads(SAVED_IMPORT);
    const res = await discard(req("discard"), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cannot_discard_committed_import" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe("a fact finder import that is still open is refused by the wizard routes", () => {
  beforeEach(() => {
    vi.mocked(requireImportAccess).mockResolvedValue({
      ...SAVED_IMPORT,
      status: "review",
      payloadJson: { factFinder: { version: 0 }, fileResults: { f1: { warnings: [] } }, payload: { accounts: [] } },
    } as never);
  });

  it("match — which would replace the whole payload", async () => {
    const res = await match(req("match"), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: FACT_FINDER_ONLY_MESSAGE });
    expect(runImportMatching).not.toHaveBeenCalled();
  });

  it("commit", async () => {
    const res = await commit(req("commit", { tabs: ["goals"] }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: FACT_FINDER_ONLY_MESSAGE });
    expect(commitTabs).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("a finished Review Wizard import (committed, no fact finder) works as before", () => {
  beforeEach(() => {
    vi.mocked(requireImportAccess).mockResolvedValue(FINISHED_WIZARD_IMPORT as never);
  });

  it("match", async () => {
    const res = await match(req("match"), params);
    expect(res.status).toBe(200);
    expect(runImportMatching).toHaveBeenCalledTimes(1);
  });

  it("commit", async () => {
    const res = await commit(req("commit", { tabs: ["goals"] }), params);
    expect(res.status).toBe(200);
    expect(commitTabs).toHaveBeenCalledTimes(1);
  });
});

describe("discard re-checks the import at its write", () => {
  /** The discard's transaction: the import UPDATE answers `importRows`; the files UPDATE one row. */
  function discardTx(importRows: unknown[]) {
    const updated: unknown[] = [];
    const tx = {
      update: vi.fn((table: unknown) => {
        updated.push(table);
        const rows = table === clientImports ? importRows : [{ id: "f1" }];
        return { set: () => ({ where: () => ({ returning: async () => rows }) }) };
      }),
    };
    vi.mocked(db.transaction).mockImplementation(async (fn: (t: never) => unknown) => fn(tx as never) as never);
    return updated;
  }
  const OPEN_FACT_FINDER = { ...SAVED_IMPORT, status: "review", payloadJson: { factFinder: { version: 2 } } };

  beforeEach(() => {
    vi.mocked(requireImportAccess).mockResolvedValue(OPEN_FACT_FINDER as never);
    discardReads(OPEN_FACT_FINDER);
  });

  it("a save that lands while the discard waits on the row: 409, the import and its files left as the save left them", async () => {
    const updated = discardTx([]);
    const res = await discard(req("discard"), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cannot_discard_committed_import" });
    expect(updated).toEqual([clientImports]);
  });

  it("an open import is discarded with its files", async () => {
    const updated = discardTx([{ id: "i1" }]);
    const res = await discard(req("discard"), params);
    expect(res.status).toBe(200);
    expect(updated).toEqual([clientImports, clientImportFiles]);
  });
});
