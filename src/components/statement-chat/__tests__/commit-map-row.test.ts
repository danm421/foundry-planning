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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("commitMapRow", () => {
  it("posts the built body to the entity's own create route", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row({ name: "Term 20", faceValue: 500000 }),
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
      row: row({ name: "Term 20", faceValue: 1 }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/policyType/);
  });

  it("surfaces the dropped-field warning rather than swallowing it", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const entity = {
      ...life,
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
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
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
    if (!result.ok) expect(result.error).toMatch(/policyId/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a network failure instead of throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const result = await commitMapRow({
      clientId: "c1",
      entity: life,
      row: row({ name: "Term 20", faceValue: 1 }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/offline/);
  });
});
