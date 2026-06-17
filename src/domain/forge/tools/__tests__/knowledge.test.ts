// src/domain/copilot/tools/__tests__/knowledge.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks -----------------------------------------------------------------
// embeddings(query) → a fixed 1536-dim vector. The exact values don't matter;
// we only assert the query was embedded and the vector reaches the SQL.
const embeddings = vi.fn<(text: string) => Promise<number[]>>();
vi.mock("../../llm", () => ({ embeddings: (t: string) => embeddings(t) }));

// assertClientReadable resolves for an in-scope client. The real guard pins
// clientId === ctx.clientId then calls verifyClientAccess; here we resolve
// undefined so the in-scope read path is exercised without a DB round-trip.
const assertClientReadable = vi.fn<() => Promise<void>>();
vi.mock("../../guards", () => ({
  assertClientReadable: () => assertClientReadable(),
}));

// Mock the drizzle `sql` tag so the captured query is an inspectable string
// with interpolated values inlined (the real tag would parameterise them, so
// the clamped LIMIT value would never appear as raw text). This lets the
// clamp assertion check the SQL the tool actually built.
vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
      "",
    ),
}));

// db.execute(query) captures the query string and returns one canned KB row.
// The neon-serverless driver returns a pg-style QueryResult, so rows live
// under `.rows`.
const executedSql: string[] = [];
const kbRow = {
  chunk_text: "irmaa surcharges apply above MAGI thresholds...",
  source: "tax_reference",
  source_ref: "Tax Ref §IRMAA",
  score: 0.91,
};
vi.mock("@/db", () => ({
  db: {
    execute: vi.fn(async (query: string) => {
      executedSql.push(query);
      return { rows: [kbRow] };
    }),
  },
}));

import { searchPlanningKb, buildKnowledgeTools } from "../knowledge";
import { buildToolContext } from "../../context";
import type { ForgeAuthContext } from "../../context";

const ctx: ForgeAuthContext = {
  userId: "u",
  firmId: "org_A",
  clientId: "c1",
  scenarioId: "base",
};

beforeEach(() => {
  executedSql.length = 0;
  embeddings.mockReset();
  embeddings.mockResolvedValue(Array(1536).fill(0.1));
  assertClientReadable.mockReset();
  assertClientReadable.mockResolvedValue(undefined);
});

describe("knowledge.ts — searchPlanningKb", () => {
  it("embeds the query and returns cited chunks with source + sourceRef + score", async () => {
    const { chunks } = await searchPlanningKb("how does IRMAA work?", 6, ctx);

    expect(embeddings).toHaveBeenCalledWith("how does IRMAA work?");
    expect(assertClientReadable).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      source: "tax_reference",
      sourceRef: "Tax Ref §IRMAA",
    });
    expect(chunks[0].text).toBe(kbRow.chunk_text);
    expect(chunks[0].score).toBeCloseTo(0.91, 5);

    // Scope WHERE is built from ctx (server-derived), never the model.
    const issued = executedSql[0];
    expect(issued).toContain("firm_id = org_A");
    expect(issued).toContain("client_id = c1");
  });

  it("clamps topK to 12 when the model over-asks", async () => {
    await searchPlanningKb("x", 999, ctx);

    // The clamped limit (12), not 999, reaches the query.
    const issued = executedSql[0];
    expect(issued).toContain("LIMIT 12");
    expect(issued).not.toContain("999");
  });
});

describe("knowledge.ts — search_planning_kb tool", () => {
  function searchTool() {
    const tools = buildKnowledgeTools(buildToolContext(ctx, "conv-1"));
    const t = tools.find((x) => x.name === "search_planning_kb");
    if (!t) throw new Error("search_planning_kb tool not found");
    return t;
  }

  it("returns cited chunks as JSON", async () => {
    const out = JSON.parse((await searchTool().invoke({ query: "irmaa" })) as string);
    expect(out.chunks).toHaveLength(1);
    expect(out.chunks[0].sourceRef).toBe("Tax Ref §IRMAA");
  });
});
