// src/components/statement-chat/__tests__/commit-map-row.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { commitMapRow } from "../commit-map-row";
import type { CandidateRow } from "@/lib/entity-extraction/types";

const life = findEntity("life_insurance_policy")!;

function row(values: Record<string, unknown>, overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    entityId: life.id,
    rowId: "r1",
    values: Object.entries(values).map(([key, value]) => ({ key, value, snippet: "x", confidence: 0.9 })),
    missingRequired: [],
    rowConfidence: 0.9,
    ...overrides,
  };
}

/**
 * A life policy `insurancePolicyCreateSchema` accepts. Since I4 (Ruling 36)
 * `buildWriteRequest` validates against the route's own create schema, so a
 * fixture that only fills the map-`required` fields is refused BEFORE the
 * network call — which is the whole point of that fix, and means a test about
 * what happens AFTER the request needs a body the route would have taken.
 */
const VALID_TERM_POLICY = {
  name: "Term 20",
  policyType: "term",
  insuredPerson: "client",
  ownerRef: { kind: "joint" },
  faceValue: 500000,
  termIssueYear: 2020,
  termLengthYears: 20,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("commitMapRow", () => {
  it("posts the built body to the entity's own create route", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row(VALID_TERM_POLICY),
    });
    expect(result.ok).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/clients/c1/insurance-policies");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ name: "Term 20", faceValue: 500000 });
  });

  it("never calls the network for a row the writer refuses", async () => {
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row({ name: "Term 20" }, { missingRequired: ["faceValue"] }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/faceValue/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the server's message when the route rejects the body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "policyType is required" }),
    } as Response);
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row(VALID_TERM_POLICY),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/policyType/);
  });

  it("surfaces the dropped-field warning rather than swallowing it", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const entity = {
      ...life,
      // `fields` replaced wholesale — life's own create schema no longer
      // describes this entity (I4).
      createSchema: undefined,
      fields: [
        { key: "name", label: "Name", kind: "string" as const, required: true },
        { key: "notes", label: "Notes", kind: "text" as const, appliesTo: "update" as const },
      ],
    };
    const result = await commitMapRow({ clientId: "c1", entity, row: row({ name: "A", notes: "hi" }) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(" ")).toMatch(/Notes/);
  });

  it("sends the merged set for a set-replacing entity, never just the new row", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const entity = {
      ...life,
      payloadShape: "array" as const,
      routes: { ...life.routes, update: "/insurance-policies/p1/beneficiaries" },
      fields: [{ key: "recipientId", label: "Recipient", kind: "string" as const }],
    };
    const result = await commitMapRow({
      clientId: "c1",
      entity,
      row: row({ recipientId: "b" }),
      existingSet: [{ recipientId: "a" }],
    });
    expect(result.ok).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/clients/c1/insurance-policies/p1/beneficiaries");
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(String(init?.body));
    expect(body).toHaveLength(2);
    expect(body).toContainEqual({ recipientId: "a" });
  });

  it("refuses an unresolved [param] placeholder in the route without calling fetch", async () => {
    const entity = {
      ...life,
      payloadShape: "array" as const,
      routes: { ...life.routes, update: "/insurance-policies/[policyId]/beneficiaries" },
      fields: [{ key: "recipientId", label: "Recipient", kind: "string" as const }],
    };
    const result = await commitMapRow({
      clientId: "c1",
      entity,
      row: row({ recipientId: "b" }),
      existingSet: [{ recipientId: "a" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(entity.id);
      expect(result.error).toContain("[policyId]");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a network failure instead of throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row(VALID_TERM_POLICY),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/offline/);
  });
});

/**
 * Task 14b Step 1 — the created record's id.
 *
 * A committed row has to be stamped `match = { kind: "exact", existingId }`
 * or a second click posts a SECOND policy. The stamp needs the id the create
 * route just wrote, and the two routes that actually take document evidence
 * disagree about where they put it: `/insurance-policies` returns `{ id }`
 * (route.ts:230) and `/disability-policies` returns `{ policy: { … } }`
 * (route.ts:105).
 */
describe("commitMapRow — the created record's id", () => {
  it("reads a top-level string id", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "pol_1" }),
    } as Response);
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row(VALID_TERM_POLICY),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.createdId).toBe("pol_1");
      // A read id is NOT a "could not be marked" case.
      expect(result.warnings.join(" ")).not.toMatch(/could not be marked/i);
    }
  });

  it("reads the id out of a single-key wrapper like { policy: { id } }", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ policy: { id: "dis_1", name: "Group LTD" } }),
    } as Response);
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row(VALID_TERM_POLICY),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.createdId).toBe("dis_1");
  });

  it("succeeds with createdId null and WARNS when the body carries no id", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row(VALID_TERM_POLICY),
    });
    // The write LANDED. Reporting a successful write as a failure would send
    // the advisor back to click Commit again — the duplicate this whole
    // mechanism exists to prevent.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.createdId).toBeNull();
      expect(result.warnings.join(" ")).toMatch(/could not be marked/i);
      expect(result.warnings.join(" ")).toMatch(/duplicate/i);
    }
  });

  it("does not guess an id out of a multi-key body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ policy: { id: "dis_1" }, meta: { ok: true } }),
    } as Response);
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row(VALID_TERM_POLICY),
    });
    expect(result.ok).toBe(true);
    // Two top-level values: which one is the record is a GUESS, and a wrong
    // id stamps the row against a record that was never created.
    if (result.ok) expect(result.createdId).toBeNull();
  });

  it("treats an unparseable success body as no id rather than a failure", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Unexpected end of JSON input");
      },
    } as unknown as Response);
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row(VALID_TERM_POLICY),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.createdId).toBeNull();
  });
});
