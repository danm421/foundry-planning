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

  it("drops an out-of-range column instead of rejecting the request", async () => {
    const res = await POST(req({
      dataRows: [["Smith", "Jane"]],
      mapping: { primaryLast: 0, primaryFirst: 1, state: 99 },
      overrides: [],
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview.rows[0].household.state).toBeUndefined();
  });

  it("400s a body that isn't a grid", async () => {
    const res = await POST(req({ dataRows: "nope", mapping: {} }) as never);
    expect(res.status).toBe(400);
  });
});
