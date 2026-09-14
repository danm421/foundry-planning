import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Gate-chain mocks ------------------------------------------------------
// Same shape as the sibling routes' tests
// (chat/extract/__tests__/gate.test.ts, chat/finalize/__tests__/route.test.ts)
// because this route copies their gate chain verbatim.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn() };
});
// NOT wholesale-mocked: this route maps @/lib/authz's ForbiddenError to 403
// explicitly, so the real class must survive the mock for `instanceof`.
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn() };
});
// Same reason: NotFoundError/ForbiddenError are mapped by `instanceof`, and
// `runMapEntityPass` throws the real NotFoundError from this module.
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

// --- Work-seam mocks -------------------------------------------------------
vi.mock("@/lib/imports/blob", () => ({ downloadImportFile: vi.fn() }));
vi.mock("@/lib/extraction/pdf-parser", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/statement-chat/map-entity-pass", () => ({ runMapEntityPass: vi.fn() }));

// --- Predicate-evaluating drizzle + @/db mocks -----------------------------
// `eq`/`and`/`isNull` become plain descriptors carrying the SQL column NAME,
// and the @/db mock below evaluates them against in-memory rows keyed by that
// same name. This is what makes the tenant test real: drop the `importId` leg
// from the file lookup and the predicate genuinely starts matching another
// import's file, instead of a where-ignoring mock returning the same row
// either way.
type Cond =
  | { op: "and"; parts: Cond[] }
  | { op: "eq"; col: string; value: unknown }
  | { op: "isNull"; col: string }
  | undefined;

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name: string }, value: unknown) => ({ op: "eq", col: col.name, value }),
    isNull: (col: { name: string }) => ({ op: "isNull", col: col.name }),
    and: (...parts: unknown[]) => ({ op: "and", parts: parts.filter(Boolean) }),
  };
});

function matches(cond: Cond, row: Record<string, unknown>): boolean {
  if (!cond) return true;
  if (cond.op === "and") return cond.parts.every((p) => matches(p, row));
  if (cond.op === "eq") return row[cond.col] === cond.value;
  if (cond.op === "isNull") return row[cond.col] === null || row[cond.col] === undefined;
  return true;
}

/** Rows of `client_import_files`, keyed by SQL column name. */
let fileTable: Record<string, unknown>[] = [];
/** Rows of `client_imports`, keyed by SQL column name (PATCH's write scope). */
let importTable: Record<string, unknown>[] = [];
let updateCalls: Array<{ patch: Record<string, unknown>; matched: number }> = [];

function seedTables() {
  fileTable = [
    {
      id: "f1",
      import_id: "i1",
      blob_url: "https://blob/statement.pdf",
      original_filename: "statement.pdf",
      deleted_at: null,
    },
    // Another firm's import, its own file. Reachable ONLY if the file lookup
    // stops scoping on importId.
    {
      id: "f_other",
      import_id: "i_other",
      blob_url: "https://blob/other.pdf",
      original_filename: "other-firm.pdf",
      deleted_at: null,
    },
    // Same import, soft-deleted.
    {
      id: "f_deleted",
      import_id: "i1",
      blob_url: "https://blob/gone.pdf",
      original_filename: "gone.pdf",
      deleted_at: new Date("2026-01-01"),
    },
  ];
  importTable = [{ id: "i1", client_id: "c1", org_id: "org_1", discarded_at: null }];
  updateCalls = [];
}

vi.mock("@/db", () => ({
  db: {
    // The only SELECT this route makes is the file lookup, so there is no
    // table discrimination here.
    select: (projection?: Record<string, { name: string }>) => ({
      from: () => ({
        where: (cond: Cond) => {
          const rows = fileTable
            .filter((r) => matches(cond, r))
            .map((r) =>
              projection
                ? Object.fromEntries(
                    Object.entries(projection).map(([key, col]) => [key, r[col.name]]),
                  )
                : r,
            );
          return Object.assign(Promise.resolve(rows), {
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          });
        },
      }),
    }),
    // The only UPDATE is PATCH's persist of the stamped row.
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          const hits = importTable.filter((r) => matches(cond, r));
          updateCalls.push({ patch, matched: hits.length });
          return Object.assign(Promise.resolve(), {
            returning: () => Promise.resolve(hits.map((r) => ({ id: r.id }))),
          });
        },
      }),
    }),
  },
}));

import { POST, PATCH } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError } from "@/lib/authz";
import { requireImportAccess, NotFoundError } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { downloadImportFile } from "@/lib/imports/blob";
import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { runMapEntityPass } from "@/lib/statement-chat/map-entity-pass";
import type { CandidateRow } from "@/lib/entity-extraction/types";

function req(body: unknown, method: "POST" | "PATCH" = "POST") {
  return new Request("http://t/api/clients/c1/imports/i1/chat/map-pass", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

function candidate(entityId: string, rowId: string): CandidateRow {
  return { entityId, rowId, values: [], missingRequired: [], rowConfidence: 1 };
}

/** A fresh import row whose chat slice already holds three extracted rows. */
function importRowWithEntityRows() {
  return {
    id: "i1",
    payloadJson: {
      fileResults: { f1: { documentType: "other" } },
      chat: {
        surface: "chat",
        entityRows: {
          entities: [candidate("entities", "r1"), candidate("entities", "r2")],
          "family-members": [candidate("family-members", "r3")],
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seedTables();

  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(requireImportAccess).mockResolvedValue(importRowWithEntityRows() as never);
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(downloadImportFile).mockResolvedValue(Buffer.from("%PDF-"));
  vi.mocked(extractPdfPages).mockResolvedValue(["page one text"]);
  vi.mocked(runMapEntityPass).mockResolvedValue({
    rows: {
      entities: [candidate("entities", "r1"), candidate("entities", "r2")],
      "family-members": [candidate("family-members", "r3")],
    },
    warnings: ["could not read existing rows"],
  });
});

describe("map-pass route — gate chain", () => {
  it("401s an unauthenticated caller and never runs the pass", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(401);
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("403s without an active subscription (@/lib/authz's own ForbiddenError)", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValueOnce(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(req({ fileId: "f1" }), params);
    // 403, NOT 500: two different classes are named ForbiddenError, and
    // catching only @/lib/imports/authz's turns this into a 500.
    expect(res.status).toBe(403);
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("404s a client that cannot be found at all", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(404);
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("403s a cross-org (shared) recipient", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "edit",
      firmId: "org_owner",
      access: "shared",
    } as never);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Cross-organization imports are not supported.",
    });
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("403s a view-only recipient", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "view",
      firmId: "org_1",
      access: "own",
    } as never);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "View-only access" });
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("429s an exceeded rate limit with Retry-After, before the pass", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: Date.now() + 5000,
    } as never);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("503s when rate limiting is unconfigured (fails closed)", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({
      allowed: false,
      reason: "unconfigured",
    } as never);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(503);
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("POST takes the rate limiter at the 'extract' op", async () => {
    await POST(req({ fileId: "f1" }), params);
    expect(checkImportRateLimit).toHaveBeenCalledWith("org_1", "extract");
  });

  it("404s an import that cannot be found for this client/firm", async () => {
    vi.mocked(requireImportAccess).mockRejectedValueOnce(new NotFoundError("Import not found"));
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(404);
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("403s ai_import_not_entitled and audits the denial", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.access_denied",
        metadata: expect.objectContaining({ reason: "ai_import_not_entitled" }),
      }),
    );
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });
});

describe("map-pass route — POST", () => {
  it("400s a body with no fileId", async () => {
    const res = await POST(req({}), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "fileId is required" });
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  // THE TENANT TEST. `f_other` is a real, live, undeleted file id — it just
  // belongs to a different import. Scoping the lookup to `importId` is the
  // only thing that refuses it.
  it("404s a file id belonging to a DIFFERENT import, and never downloads it", async () => {
    const res = await POST(req({ fileId: "f_other" }), params);
    expect(res.status).toBe(404);
    expect(downloadImportFile).not.toHaveBeenCalled();
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("404s a soft-deleted file of this same import", async () => {
    const res = await POST(req({ fileId: "f_deleted" }), params);
    expect(res.status).toBe(404);
    expect(downloadImportFile).not.toHaveBeenCalled();
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("502s (naming the file) when the blob cannot be read", async () => {
    vi.mocked(downloadImportFile).mockResolvedValue(null);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("statement.pdf");
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("refuses a zero-page extraction without spending an Azure call", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue([]);
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("statement.pdf");
    expect(runMapEntityPass).not.toHaveBeenCalled();
  });

  it("runs the pass with the resolved file/pages and returns { rows, warnings }", async () => {
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(200);
    expect(downloadImportFile).toHaveBeenCalledWith("https://blob/statement.pdf");
    expect(runMapEntityPass).toHaveBeenCalledWith({
      importId: "i1",
      clientId: "c1",
      firmId: "org_1",
      fileId: "f1",
      pages: ["page one text"],
    });
    const body = await res.json();
    expect(Object.keys(body.rows)).toEqual(["entities", "family-members"]);
    expect(body.warnings).toEqual(["could not read existing rows"]);
  });

  it("audits the completed pass against the FILE id with entity and row counts", async () => {
    await POST(req({ fileId: "f1" }), params);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "import.map_pass.completed",
      resourceType: "client_import_file",
      resourceId: "f1",
      clientId: "c1",
      firmId: "org_1",
      metadata: { importId: "i1", entityCount: 2, rowCount: 3 },
    });
  });

  it("404s (not 500) when the pass's own scoping refuses the write", async () => {
    vi.mocked(runMapEntityPass).mockRejectedValueOnce(new NotFoundError("Import not found"));
    const res = await POST(req({ fileId: "f1" }), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Import not found" });
  });

  it("does not audit a pass that never completed", async () => {
    vi.mocked(runMapEntityPass).mockRejectedValueOnce(new NotFoundError("Import not found"));
    await POST(req({ fileId: "f1" }), params);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("map-pass route — PATCH", () => {
  it("stamps match on the NAMED row only and persists it", async () => {
    const res = await PATCH(
      req({ entityId: "entities", rowId: "r2", createdId: "ent_99" }, "PATCH"),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].patch.payloadJson as {
      fileResults: unknown;
      chat: { entityRows: Record<string, CandidateRow[]> };
    };
    const rows = written.chat.entityRows;
    expect(rows.entities[1].match).toEqual({ kind: "exact", existingId: "ent_99" });
    // Siblings untouched — in the same entity and in another entity.
    expect(rows.entities[0].match).toBeUndefined();
    expect(rows["family-members"][0].match).toBeUndefined();
    // The rest of the payload survives the write.
    expect(written.fileResults).toEqual({ f1: { documentType: "other" } });
  });

  it("scopes the write to this client/firm and non-discarded import", async () => {
    await PATCH(req({ entityId: "entities", rowId: "r2", createdId: "ent_99" }, "PATCH"), params);
    expect(updateCalls[0].matched).toBe(1);

    // The same PATCH against an import belonging to another firm writes nothing.
    updateCalls = [];
    importTable = [{ id: "i1", client_id: "c1", org_id: "org_OTHER", discarded_at: null }];
    const res = await PATCH(
      req({ entityId: "entities", rowId: "r2", createdId: "ent_99" }, "PATCH"),
      params,
    );
    expect(updateCalls[0].matched).toBe(0);
    expect(res.status).toBe(404);
  });

  it("404s an unknown rowId and writes nothing", async () => {
    const res = await PATCH(
      req({ entityId: "entities", rowId: "nope", createdId: "ent_99" }, "PATCH"),
      params,
    );
    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });

  it("404s an unknown entityId and writes nothing", async () => {
    const res = await PATCH(
      req({ entityId: "not-an-entity", rowId: "r2", createdId: "ent_99" }, "PATCH"),
      params,
    );
    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });

  it("400s an incomplete body", async () => {
    const res = await PATCH(req({ entityId: "entities", rowId: "r2" }, "PATCH"), params);
    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("runs the same gate chain — 403s a view-only recipient, writing nothing", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "view",
      firmId: "org_1",
      access: "own",
    } as never);
    const res = await PATCH(
      req({ entityId: "entities", rowId: "r2", createdId: "ent_99" }, "PATCH"),
      params,
    );
    expect(res.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });

  it("takes the rate limiter at the cheap 'match' op, not 'extract'", async () => {
    await PATCH(req({ entityId: "entities", rowId: "r2", createdId: "ent_99" }, "PATCH"), params);
    expect(checkImportRateLimit).toHaveBeenCalledWith("org_1", "match");
  });
});
