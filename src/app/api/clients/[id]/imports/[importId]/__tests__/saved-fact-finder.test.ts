// src/app/api/clients/[id]/imports/[importId]/__tests__/saved-fact-finder.test.ts
//
// A fact finder saved to the plan keeps its closed record and change list in
// `payload_json` (Plan 4, Review Focus 5). The legacy routes that write an
// import's payload or status, and have no route test of their own, refuse one
// before doing any work: matching (which replaces the whole payload) and
// committing tabs; discarding refuses every committed import, as it always
// did. Every other import — a statement-chat import closed with "Finish
// import" included — goes through as before Plan 4.
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
import { requireOrgId } from "@/lib/db-helpers";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";
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

/** A statement-chat import closed with "Finish import": committed, and no fact finder in its payload. */
const FINISHED_CHAT_IMPORT = { ...SAVED_IMPORT, payloadJson: { chat: { surface: "chat" }, fileResults: { f1: { warnings: [] } }, payload: { accounts: [] } } };

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
    const res = await discard(req("discard"), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cannot_discard_committed_import" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe("a finished statement-chat import (committed, no fact finder) works as before", () => {
  beforeEach(() => {
    vi.mocked(requireImportAccess).mockResolvedValue(FINISHED_CHAT_IMPORT as never);
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
