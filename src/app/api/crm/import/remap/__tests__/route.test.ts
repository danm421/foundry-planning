import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test_org_remap") };
});

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkImportRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  };
});

vi.mock("@/lib/crm/households", () => ({
  listCrmHouseholds: vi.fn().mockResolvedValue([]),
}));

import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { POST } from "../route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/crm/import/remap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/crm/import/remap", () => {
  it("re-derives the preview from a corrected mapping", async () => {
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview.rows[0].household.name).toBe("Jane Smith");
    expect(json.preview.rows[0].errors).toEqual([]);
  });

  it("applies an override on top of the file's cells", async () => {
    const res = await POST(req({
      dataRows: [["Smith", ""]],
      mapping: { primaryLast: 0, primaryFirst: 1 },
      overrides: [{ rowIndex: 0, field: "primaryFirst", value: "Jane" }],
    }) as never);
    const json = await res.json();
    expect(json.preview.rows[0].errors).toEqual([]);
    expect(json.preview.rows[0].primary.firstName).toBe("Jane");
  });

  // rows.ts only surfaces whether a REQUIRED field's mapping entry was
  // dropped (vs merely empty) through the error text — everything else
  // reads a missing column as "" via `cells[col] ?? ""` regardless of
  // whether sanitizeMapping ever saw it. So this is the one case in the
  // file that actually discriminates sanitizeMapping's out-of-range drop:
  // primaryFirst points at column 500 (past MAX_COLUMNS=200) with no other
  // source for the name, so the message can only read "No column is mapped
  // to..." if sanitizeMapping genuinely deleted the entry — an
  // identity pass-through would leave mapping.primaryFirst = 500, which
  // flips the error to "Primary first name is required." instead.
  // Confirmed by mutation: swapping the route's sanitizeMapping(...) call
  // for an identity function turns this test red (wrong message) while
  // leaving the four cases below green. See task-7-report.md for the
  // recorded run.
  it("drops a mapping entry that points past the sanitize bound, leaving the field genuinely unmapped", async () => {
    const res = await POST(req({
      dataRows: [["Smith"]],
      mapping: { primaryLast: 0, primaryFirst: 500 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview.rows[0].errors).toEqual([
      { field: "primaryFirst", message: "No column is mapped to Primary first name." },
    ]);
  });

  // The four cases below all land on "never fatal" — none of them 400s or
  // drops the row. They do NOT individually prove sanitizeMapping is doing
  // the dropping, though: rows.ts reads an absent field the same way it
  // reads one whose mapped column is out of bounds (`cells[col] ?? ""`),
  // so an identity pass-through of the mapping produces the identical
  // "" for state/postalCode and never touches an unknown key at all
  // (buildRows only ever looks up known ImportField names). Kept anyway
  // because they're one line each and they do cover the "never fatal"
  // contract across the input space the wizard can actually send.
  it("drops an out-of-range column instead of rejecting the request", async () => {
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1, state: 500 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview.rows[0].household.state).toBeUndefined();
  });

  it("ignores an unknown mapping key instead of rejecting the request", async () => {
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1, bogus: 0 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview.rows[0].errors).toEqual([]);
  });

  it("ignores a negative mapping index instead of rejecting the request", async () => {
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1, state: -1 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview.rows[0].household.state).toBeUndefined();
  });

  it("ignores a non-integer mapping index instead of rejecting the request", async () => {
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1, postalCode: 1.5 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview.rows[0].primary.postalCode).toBeUndefined();
  });

  it("400s a body that isn't a grid", async () => {
    const res = await POST(req({ dataRows: "nope", mapping: {} }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 401 when there is no Clerk org context", async () => {
    vi.mocked(requireOrgId).mockRejectedValueOnce(new UnauthorizedError());
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(401);
  });

  it("returns 429 when the view rate limit is exceeded", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: Date.now() + 5000,
    });
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(429);
  });

  it("treats an omitted overrides field as an empty list", async () => {
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1 },
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview.rows[0].household.name).toBe("Jane Smith");
    expect(json.preview.rows[0].errors).toEqual([]);
  });
});
