import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors the mock setup in
// src/app/api/clients/[id]/imports/[importId]/chat/extract/__tests__/gate.test.ts
// — same gate chain (Ruling 70), so the same mock shape.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
// NOT wholesale-mocked: this route maps @/lib/authz's ForbiddenError to 403
// explicitly, so the real class must survive the mock for `instanceof`.
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn() };
});
vi.mock("@/lib/imports/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/authz")>(
    "@/lib/imports/authz",
  );
  return { ...actual, requireImportAccess: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi
    .fn()
    .mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// A SPY, not a replacement: the real `markTabsCommitted` still runs (every
// status assertion in this file depends on its real completeness predicate),
// but the tab list it was handed is recorded so the liabilities tests can
// assert on it directly. Which tabs get stamped is the whole subject of the
// finalize landmine — a status assertion alone cannot tell a correct stamp
// from an unconditional one.
vi.mock("@/lib/imports/commit/orchestrator", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/commit/orchestrator")>(
    "@/lib/imports/commit/orchestrator",
  );
  return { ...actual, markTabsCommitted: vi.fn(actual.markTabsCommitted) };
});

// --- @/db mock — only ever reached by markTabsCommitted, on the happy path.
// A stateful `existingRow` models `client_imports.perTabCommittedAt` /
// `committedAt` at the moment markTabsCommitted reads it; `updateCalls`
// records every UPDATE so the premature-finalize test can assert NONE
// happened (status untouched is a "never wrote," not just "wrote the same
// thing back").
let updateCalls: Array<{ values: Record<string, unknown> }> = [];
let existingRow: { perTabCommittedAt: Record<string, string> | null; committedAt: string | null } =
  { perTabCommittedAt: null, committedAt: null };

vi.mock("@/db", () => {
  const select = () => ({ from: () => ({ where: () => Promise.resolve([existingRow]) }) });
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        updateCalls.push({ values });
        return Promise.resolve();
      },
    }),
  });
  return {
    db: {
      select,
      update,
      transaction: (fn: (tx: { select: typeof select; update: typeof update }) => unknown) =>
        Promise.resolve(fn({ select, update })),
    },
  };
});

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { mergeAcrossFiles } from "@/lib/imports/assemble/merge-across-files";
import { detectRollups } from "@/lib/statement-chat/rollups";
import { markTabsCommitted } from "@/lib/imports/commit/orchestrator";
import { dropRow, mergeRows } from "@/lib/statement-chat/tools";
import type { ExtractionResult } from "@/lib/extraction/types";
import type { ImportPayloadJson } from "@/lib/imports/types";

function extractionResult(
  accounts: Array<{ name: string; custodian?: string; value?: number }>,
): ExtractionResult {
  return {
    documentType: "other",
    fileName: "statement.pdf",
    extracted: {
      accounts: accounts as never,
      incomes: [],
      expenses: [],
      liabilities: [],
      entities: [],
      lifePolicies: [],
      wills: [],
      savings: [],
      goals: [],
    },
    warnings: [],
    promptVersion: "v",
  } as unknown as ExtractionResult;
}

/** Two plain accounts, no rollup — a clean two-row fixture. */
const CLEAN_FILE_RESULTS: Record<string, ExtractionResult> = {
  f1: extractionResult([
    { name: "IRA", custodian: "Schwab", value: 100 },
    { name: "Brokerage", custodian: "Schwab", value: 200 },
  ]),
};

/** Two real accounts plus a printed total for the same custodian — the
 *  total is `detectRollups`-excluded and must never gate closing. */
const ROLLUP_FILE_RESULTS: Record<string, ExtractionResult> = {
  f1: extractionResult([
    { name: "IRA", custodian: "Schwab", value: 100 },
    { name: "Brokerage", custodian: "Schwab", value: 200 },
    { name: "Total Accounts", custodian: "Schwab", value: 300 },
  ]),
};

/** The real `__rowId`s `mergeAcrossFiles` + `detectRollups` assign for a
 *  fixture — computed the same way the route itself does, rather than
 *  guessed, so a change to the id scheme can't silently desync the fixture
 *  from the assertion. */
function keptRowIds(fileResults: Record<string, ExtractionResult>): string[] {
  const { payload } = mergeAcrossFiles(fileResults);
  const { kept } = detectRollups(payload.accounts);
  return kept.map((r) => r.__rowId as string);
}

/**
 * A realistic `payloadJson.payload.accounts` for a fixture — the kept rows,
 * each already linked (`match: {kind: "exact"}`) as they would be after the
 * per-row commits chat-surface.tsx ran before this finalize call, so
 * `presenceFromPayload` sees real accounts presence (not an empty array)
 * and `requiredCommitTabs` genuinely requires "accounts" — proving the
 * route stamps THAT tab, not just "plan-basics".
 */
function persistedAccounts(fileResults: Record<string, ExtractionResult>) {
  const { payload } = mergeAcrossFiles(fileResults);
  const { kept } = detectRollups(payload.accounts);
  return kept.map((row, i) => ({ ...row, match: { kind: "exact", existingId: `acct-${i}` } }));
}

/** The tools refuse a row that is already committed (C3); these fixtures
 *  build the pre-commit state, so nothing is committed at tool time. */
const NO_COMMITTED_ROWS: ReadonlySet<string> = new Set<string>();

function importRow(payloadJson: ImportPayloadJson) {
  return { id: "i1", payloadJson };
}

function req() {
  return new Request("http://t/api/clients/c1/imports/i1/chat/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls = [];
  existingRow = { perTabCommittedAt: null, committedAt: null };

  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(requireImportAccess).mockResolvedValue(
    importRow({
      fileResults: CLEAN_FILE_RESULTS,
      chat: {
        surface: "chat",
        transcript: [],
        decisions: [],
        excludedRows: [],
        committedRowIds: keptRowIds(CLEAN_FILE_RESULTS),
      },
      payload: { accounts: persistedAccounts(CLEAN_FILE_RESULTS) as never },
    }) as never,
  );
});

describe("chat finalize route gates", () => {
  it("401s an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
  });

  it("403s without an active subscription (@/lib/authz's own ForbiddenError)", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValueOnce(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(requireImportAccess).not.toHaveBeenCalled();
  });

  it("404s a client that cannot be found at all", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("403s a shared (cross-org) recipient with access='shared'", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "edit",
      firmId: "org_owner",
      access: "shared",
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Cross-organization imports are not supported.",
    });
  });

  it("403s a view-only recipient", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "view",
      firmId: "org_1",
      access: "own",
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "View-only access" });
  });

  it("returns the rate-limit response before touching the import", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: Date.now() + 5000,
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(429);
    expect(requireImportAccess).not.toHaveBeenCalled();
  });

  it("503s when rate limiting is unconfigured (fails closed)", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({
      allowed: false,
      reason: "unconfigured",
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(503);
  });

  it("403s ai_import_not_entitled when the entitlement is absent", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
    expect(updateCalls).toHaveLength(0);
  });

  it("404s when the import itself cannot be found for this client/firm", async () => {
    const { NotFoundError } = await import("@/lib/imports/authz");
    vi.mocked(requireImportAccess).mockRejectedValueOnce(new NotFoundError("Import not found"));
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("403s an import owned by a different advisor (@/lib/imports/authz's ForbiddenError)", async () => {
    const { ForbiddenError: ImportForbiddenError } = await import("@/lib/imports/authz");
    vi.mocked(requireImportAccess).mockRejectedValueOnce(
      new ImportForbiddenError("Import not owned by current user"),
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
  });
});

describe("chat finalize verification (Ruling 70)", () => {
  it("closes the import once every kept row is committed", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });

    // markTabsCommitted actually ran and persisted — not just a 200 that
    // never touched the database.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.status).toBe("committed");
    expect(updateCalls[0].values.committedAt).toBeInstanceOf(Date);

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "import.chat.finalized", resourceId: "i1" }),
    );
  });

  // THE test that matters (brief): if the verification is ever removed or
  // weakened, this must be the one that reddens.
  it("409s a premature finalize with one row uncommitted, and never touches the import", async () => {
    const ids = keptRowIds(CLEAN_FILE_RESULTS);
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: CLEAN_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: [ids[0]], // one of the two kept rows is missing
        },
        payload: { accounts: persistedAccounts(CLEAN_FILE_RESULTS) as never },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("1 account row");

    // Status untouched: no UPDATE, no audit row, for this call.
    expect(updateCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  // C1 (final review): a row the advisor retired IN THE CHAT is gone from
  // the working table but comes back out of the route's own recompute (which
  // reads `fileResults`, raw extraction no tool ever edits). Before the fix
  // it was demanded at close forever — a permanent 409 raised by the
  // branch's headline tool.
  //
  // Both fixtures below are produced by the REAL tools (`dropRow` /
  // `mergeRows`), not hand-written: `chat.excludedRows` and
  // `payload.accounts` are exactly what a turn persists, so a change to
  // either shape reddens this instead of quietly passing against a fiction.
  function afterDroppingSecondRow() {
    const { payload } = mergeAcrossFiles(CLEAN_FILE_RESULTS);
    const { kept } = detectRollups(payload.accounts);
    const ids = kept.map((r) => r.__rowId as string);
    const result = dropRow({ accounts: kept }, { rowId: ids[1], reason: "not the client's" }, NO_COMMITTED_ROWS);
    return { ids, result };
  }

  it("closes the import after a drop_row retired a row that was never committed", async () => {
    const { ids, result } = afterDroppingSecondRow();
    expect(result.excludedRows?.[0].row.__rowId).toBe(ids[1]);

    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: CLEAN_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: result.excludedRows ?? [],
          committedRowIds: [ids[0]], // only the surviving row was committed
        },
        payload: result.payload as never,
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
  });

  // The unrecoverable half: `merge_rows` stamps `irreversible: true`, so
  // "Include anyway" is disabled for the retired row (excluded-rows.tsx) and
  // the advisor has no way to put it back and commit it. If close still
  // demanded it, the import could never be closed by any route at all.
  it("closes the import after an irreversible merge_rows retired a row", async () => {
    const { payload } = mergeAcrossFiles(CLEAN_FILE_RESULTS);
    const { kept } = detectRollups(payload.accounts);
    const ids = kept.map((r) => r.__rowId as string);
    const result = mergeRows({ accounts: kept }, { keepRowId: ids[0], mergeRowId: ids[1] }, NO_COMMITTED_ROWS);
    expect(result.excludedRows?.[0]).toMatchObject({ irreversible: true });

    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: CLEAN_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: result.excludedRows ?? [],
          committedRowIds: [ids[0]],
        },
        payload: result.payload as never,
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
  });

  // The exclusion must not become a blanket amnesty: a row that is neither
  // committed NOR excluded still blocks the close.
  it("still 409s a row that is neither committed nor excluded in the chat", async () => {
    const { result } = afterDroppingSecondRow();
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: CLEAN_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: result.excludedRows ?? [],
          committedRowIds: [], // the SURVIVING row was never committed
        },
        payload: result.payload as never,
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("1 account row");
    expect(updateCalls).toHaveLength(0);
  });

  it("closes the import even though an excluded rollup row was never committed", async () => {
    const ids = keptRowIds(ROLLUP_FILE_RESULTS);
    expect(ids).toHaveLength(2); // the printed total is excluded, not kept
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: ROLLUP_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: ids, // both KEPT rows committed; the rollup never is
        },
        payload: { accounts: persistedAccounts(ROLLUP_FILE_RESULTS) as never },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
  });

  /**
   * ── Fix wave 3, C-A: THE ID THE ADVISOR'S SESSION HOLDS IS AN OLD ONE ───
   *
   * `__rowId` is DERIVED — the dedupe key plus the entry's minimum source
   * coordinate — so adding a statement whose file id sorts lower MOVES it.
   * Wave 4 made the rebase carry the standing row's id forward onto the
   * fresh row, which satisfies every reader of `payload.accounts`. This
   * route is not one of those readers: it re-derives `kept` from
   * `fileResults` (deliberately — see its own comment) and compared THAT
   * against `chat.committedRowIds`, which holds the id minted by the
   * EARLIER merge. The two are in different id namespaces, so the row the
   * advisor already committed counted as missing and the import 409'd
   * forever: the row shows Committed so its button is disabled,
   * `assertNotCommitted` blocks `drop_row`, and there is no force-close.
   *
   * WHY THE EXISTING TESTS COULD NOT CATCH IT. Every other fixture in this
   * file derives `committedRowIds` from `keptRowIds(...)` — the SAME merge
   * the route is about to run — so the two ids can never disagree and the
   * suite is blind by construction. The ids below are LITERAL and
   * old-shaped: minted off the June file alone, before September existed.
   *
   * Mutation this catches: taking `missing` from the raw recompute instead
   * of from the reconciled rows (i.e. reverting the rebase call). 409.
   */
  const JUNE_FILE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
  const SEPT_FILE = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84"; // sorts FIRST
  /** The id the June-only merge minted, and the only id the advisor's
   *  session ever recorded. Written out, never derived. */
  const OLD_ROTH_ID = `account:7734#${JUNE_FILE}:0`;
  const OLD_DADS_ID = `account:5521#${JUNE_FILE}:1`;

  function statement(statementDate: string, values: [number, number]): ExtractionResult {
    return extractionResult([
      {
        name: "Roth IRA",
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        owner: "client",
        value: values[0],
        statementDate,
      },
      {
        name: "Dad's IRA",
        custodian: "Fidelity",
        accountNumberLast4: "5521",
        owner: "client",
        value: values[1],
        statementDate,
      },
    ] as never);
  }

  /** June read first, then a NEWER September statement added for the same
   *  two accounts — the path the UI actively invites ("You can still upload
   *  another statement first"). */
  const TWO_STATEMENTS: Record<string, ExtractionResult> = {
    [JUNE_FILE]: statement("2026-06-30", [190_000, 44_000]),
    [SEPT_FILE]: statement("2026-09-30", [201_900, 45_100]),
  };

  /** What wave 4's rebase leaves in `payload.accounts`: the fresh rows,
   *  re-stamped with the ids the advisor's session holds. */
  function standingRow(rowId: string, name: string, last4: string, value: number) {
    return {
      name,
      custodian: "Fidelity",
      accountNumberLast4: last4,
      owner: "client",
      value,
      statementDate: "2026-06-30",
      __rowId: rowId,
      __provenance: { sourceFileId: JUNE_FILE, section: "accounts" },
      match: { kind: "exact", existingId: `acct-${last4}` },
    };
  }

  it("closes an import whose committed row ids were minted by an EARLIER merge", async () => {
    // Proof the fixture is the drifted case and not a tautology: the ids
    // this merge produces are NOT the ids the advisor's session holds.
    expect(keptRowIds(TWO_STATEMENTS)).not.toContain(OLD_ROTH_ID);

    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: TWO_STATEMENTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: [OLD_ROTH_ID, OLD_DADS_ID],
        },
        payload: {
          accounts: [
            standingRow(OLD_ROTH_ID, "Julia — Roth (rollover)", "7734", 190_000),
            standingRow(OLD_DADS_ID, "Dad's IRA", "5521", 44_000),
          ] as never,
        },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
    expect(updateCalls).toHaveLength(1);
  });

  /**
   * Fix wave 3, I-A, at this route. The advisor's `drop_row` decision is
   * persisted under the id the row had AT THE TIME, and the same drift
   * leaves `chatExcluded` naming nothing in the recompute — so the row they
   * explicitly dropped is demanded at close.
   *
   * Mutation this catches: the same one — comparing against the raw
   * recompute rather than the reconciled rows.
   */
  it("does not demand a chat-excluded row whose id moved after a newer upload", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: TWO_STATEMENTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          // Dropped when June was the only file, so keyed by the June id.
          excludedRows: [
            {
              row: standingRow(OLD_DADS_ID, "Dad's IRA", "5521", 44_000) as never,
              reason: "not the client's account",
            },
          ],
          committedRowIds: [OLD_ROTH_ID],
        },
        payload: {
          accounts: [standingRow(OLD_ROTH_ID, "Julia — Roth (rollover)", "7734", 190_000)] as never,
        },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
  });

  /**
   * The other half of the same edit, and the property the route's own
   * comment at `:166-172` defends: the base stays the SERVER's recompute
   * from `fileResults`, never `payload.accounts`. A row that never reached
   * the persisted payload at all must still be demanded.
   *
   * Mutation this catches: "fixing" C-A by taking `missing` from
   * `payload.accounts` instead of rebasing the recompute onto it. This
   * import would then close with a real, uncommitted account unimported.
   */
  it("still 409s an account that is missing from payload.accounts entirely", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: TWO_STATEMENTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: [OLD_ROTH_ID],
        },
        // Only ONE of the two real accounts is on the table.
        payload: {
          accounts: [standingRow(OLD_ROTH_ID, "Julia — Roth (rollover)", "7734", 190_000)] as never,
        },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("1 account row");
    expect(updateCalls).toHaveLength(0);
  });
});

/**
 * ── Task 10: THE FINALIZE LANDMINE ──────────────────────────────────────
 *
 * `requiredCommitTabs` derives the tabs an import must commit from what the
 * PAYLOAD holds (`required-tabs.ts:46,85`): one liability row makes the
 * "liabilities" tab mandatory. This route used to stamp exactly
 * `["accounts", "plan-basics"]` — so the moment the chat surface started
 * carrying liabilities, every import with a mortgage on it would stamp two
 * of the three tabs it needs and `markTabsCommitted` would never flip the
 * status: `review` forever, with no other route able to close it.
 */
describe("chat finalize stamps the liabilities tab (Task 10)", () => {
  /** One persisted, already-linked mortgage — what the per-row commits leave
   *  on `payload.liabilities` before finalize runs. */
  const MORTGAGE = {
    name: "Mortgage",
    balance: 412_000,
    interestRate: 0.0625,
    __rowId: "liability:mortgage#f1:0",
    match: { kind: "exact", existingId: "liab-1" },
  };

  function withLiabilities(
    liabilities: unknown[],
    chatOver: { committedRowIds?: string[]; excludedRows?: unknown[] } = {},
  ) {
    return importRow({
      fileResults: CLEAN_FILE_RESULTS,
      chat: {
        surface: "chat",
        transcript: [],
        decisions: [],
        excludedRows: (chatOver.excludedRows ?? []) as never,
        committedRowIds: chatOver.committedRowIds ?? keptRowIds(CLEAN_FILE_RESULTS),
      },
      payload: {
        accounts: persistedAccounts(CLEAN_FILE_RESULTS) as never,
        liabilities: liabilities as never,
      },
    }) as never;
  }

  /** The accounts-only committed set, plus the mortgage's own row id. */
  function alsoCommitted(rowId: string) {
    return [...keptRowIds(CLEAN_FILE_RESULTS), rowId];
  }

  it("reaches status 'committed' once the liability row has actually been committed", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(
      withLiabilities([MORTGAGE], { committedRowIds: alsoCommitted(MORTGAGE.__rowId) }),
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    // The behaviour that matters: WITHOUT the stamp `requiredCommitTabs`
    // demands a "liabilities" entry nothing ever writes, so this reads
    // "review" and the import is stuck for good.
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
    expect(updateCalls[0].values.status).toBe("committed");

    expect(markTabsCommitted).toHaveBeenCalledWith(
      expect.anything(),
      "i1",
      ["accounts", "plan-basics", "liabilities"],
      expect.objectContaining({ liabilities: [MORTGAGE] }),
    );
  });

  /**
   * ── Final review I2 ────────────────────────────────────────────────────
   *
   * This test previously asserted the OPPOSITE, and encoded the defect: it
   * seeded accounts-only `committedRowIds` with the mortgage uncommitted and
   * demanded `status: "committed"`. So the advisor closed the import, the
   * record said every tab was done, and the mortgage had never been written
   * to the plan — the exact user-visible failure this branch exists to remove.
   *
   * The 409 gate above reconciles ACCOUNT rows only and deliberately still
   * does: Task 8 disables Commit on an unresolvable fuzzy liability, so
   * folding debts into `missing` would make that row a permanent 409 with no
   * way out. This is the stamp side instead — always a 200, the import simply
   * stays `review` until the advisor commits the row or drops it in the chat.
   *
   * Mutation this catches: restoring the presence-only stamp
   * (`if (persistedPayload.liabilities.length > 0)`).
   */
  it("does NOT stamp the liabilities tab while a liability row is still uncommitted", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(withLiabilities([MORTGAGE]));

    const res = await POST(req(), params);
    // A 200, not a 409: the advisor is never locked out of their own import.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "review" });
    expect(markTabsCommitted).toHaveBeenCalledWith(
      expect.anything(),
      "i1",
      ["accounts", "plan-basics"],
      expect.anything(),
    );
  });

  /**
   * EVERY non-excluded row, not just one. A predicate written with `.some()`
   * would pass the positive test above and still close an import whose second
   * mortgage never committed.
   *
   * Mutation this catches: `.every(` → `.some(`.
   */
  it("does NOT stamp the tab when only one of two liability rows is committed", async () => {
    const heloc = { ...MORTGAGE, name: "HELOC", __rowId: "liability:heloc#f1:1" };
    vi.mocked(requireImportAccess).mockResolvedValue(
      withLiabilities([MORTGAGE, heloc], {
        committedRowIds: alsoCommitted(MORTGAGE.__rowId),
      }),
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "review" });
    expect(markTabsCommitted).toHaveBeenCalledWith(
      expect.anything(),
      "i1",
      ["accounts", "plan-basics"],
      expect.anything(),
    );
  });

  /**
   * "Excluded" has to mean ONE thing in this route — the same
   * `chat.excludedRows` set the accounts gate already reads — or a row can be
   * demanded by one half and forgiven by the other.
   *
   * Measured honestly: today `drop_row` also removes the debt from
   * `payload.liabilities` (`tools.ts:845-852`) and the extract route subtracts
   * the same ids from its rebase, so this leg is a SAFETY NET rather than a
   * path the surface can currently reach. It is kept because the accounts side
   * needs exactly this leg (a dropped account DOES come back out of the fresh
   * recompute), and a second, divergent notion of "excluded" here is how the
   * two halves drift apart. The state below is representable; it is simply not
   * one the chat tools produce today.
   *
   * Mutation this catches: dropping the `chatExcluded.has(...)` clause.
   */
  it("treats a chat-excluded liability row as not owed", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(
      withLiabilities([MORTGAGE], {
        excludedRows: [{ row: MORTGAGE, reason: "Already on the plan" }],
      }),
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
    expect(markTabsCommitted).toHaveBeenCalledWith(
      expect.anything(),
      "i1",
      ["accounts", "plan-basics", "liabilities"],
      expect.anything(),
    );
  });

  // The other direction. An unconditional stamp would pass the test above
  // and still be wrong: it would record a "liabilities" tab as committed on
  // an import that has no liabilities and for which `commitLiabilities`
  // never ran — the same class of lie the wizard-import guard below exists
  // to prevent.
  it("does not stamp the liabilities tab for an import with no liabilities", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(markTabsCommitted).toHaveBeenCalledWith(
      expect.anything(),
      "i1",
      ["accounts", "plan-basics"],
      expect.anything(),
    );
  });

  // The predicate must read the SAME object `markTabsCommitted` hands to
  // `presenceFromPayload`, or the stamp and the completeness check can
  // disagree. An empty array is presence-false on both sides.
  it("does not stamp the liabilities tab for an empty liabilities array", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(withLiabilities([]));

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
    expect(markTabsCommitted).toHaveBeenCalledWith(
      expect.anything(),
      "i1",
      ["accounts", "plan-basics"],
      expect.anything(),
    );
  });
});

describe("chat finalize surface guard (round 1 review, Important 2)", () => {
  // The reviewed hole: a wizard import (tax return, wills, policies — no
  // chat step, no account rows in `fileResults`) sails through the
  // `missing` check with nothing to verify, and without this guard would
  // get "accounts" and "plan-basics" stamped and possibly closed, even
  // though `commitPlanBasics` never ran and `payload.planBasics` was never
  // written anywhere.
  it("400s an import with no chat surface, even when it has nothing to commit", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        // No `chat` key at all — `readChatState` would normalize this to
        // `surface: "chat"` regardless (it fills in a default shape for
        // ANY payload), which is exactly why the guard must be a direct
        // optional-chain read instead.
        fileResults: {},
        payload: { accounts: [] as never, planBasics: {} as never },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This import is not a statement-chat import." });
    // Never touched: no stamp, no audit row.
    expect(updateCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
