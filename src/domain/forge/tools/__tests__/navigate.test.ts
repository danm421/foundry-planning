import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock emitNavigate so the tool's call can be asserted without dispatching a
// real LangGraph custom event. The real emitNavigate throws on a
// non-allowlisted href (defence in depth) — model the same contract here so the
// error-path test exercises the tool's try/catch, not the (stubbed) emitter.
// Hoisted so the vi.mock factory (itself hoisted) can close over it safely.
const { emitNavigate, emitPageLink } = vi.hoisted(() => ({
  emitNavigate: vi.fn(async (href: string) => {
    if (!href.startsWith("/clients/") && !href.startsWith("/cma/")) {
      throw new Error("navigate href not allowlisted");
    }
  }),
  emitPageLink: vi.fn(async (href: string) => {
    if (!href.startsWith("/clients/") && !href.startsWith("/cma/")) {
      throw new Error("page_link href not allowlisted");
    }
  }),
}));
vi.mock("../../custom-events", () => ({ emitNavigate, emitPageLink }));

import { buildNavigateTools } from "../navigate";
import { buildTools, WRITE_TOOL_NAMES } from "../index";
import type { ForgeToolContext } from "../../context";

// ForgeToolContext nests the auth scope under `ctx`; clientId is server-derived.
const toolCtx: ForgeToolContext = {
  ctx: { userId: "u1", firmId: "f1", clientId: "c1", scenarioId: "base" },
  conversationId: "conv_1",
};

describe("open_page navigation tool", () => {
  beforeEach(() => {
    emitNavigate.mockClear();
    emitPageLink.mockClear();
  });

  it("exposes open_page and cite_page", () => {
    const tools = buildNavigateTools(toolCtx);
    expect(tools.map((t) => t.name)).toEqual(["open_page", "cite_page"]);
  });

  it("emits a navigate frame to the resolved /clients/<clientId>/<section> path and confirms", async () => {
    const tool = buildNavigateTools(toolCtx)[0];
    const out = await tool.invoke({ section: "cashflow" });
    expect(emitNavigate).toHaveBeenCalledWith("/clients/c1/cashflow");
    expect(JSON.parse(out)).toMatchObject({ navigated: true, section: "cashflow" });
  });

  it("resolves nested + renamed sections to their real route paths", async () => {
    const tool = buildNavigateTools(toolCtx)[0];
    await tool.invoke({ section: "monte-carlo" });
    expect(emitNavigate).toHaveBeenCalledWith("/clients/c1/cashflow/monte-carlo");

    emitNavigate.mockClear();
    await tool.invoke({ section: "estate" });
    expect(emitNavigate).toHaveBeenCalledWith("/clients/c1/estate-planning");

    emitNavigate.mockClear();
    await tool.invoke({ section: "reports" });
    expect(emitNavigate).toHaveBeenCalledWith("/clients/c1/presentations");

    emitNavigate.mockClear();
    await tool.invoke({ section: "scenarios" });
    expect(emitNavigate).toHaveBeenCalledWith("/clients/c1/solver");
  });

  it("builds the path from ctx.clientId, never a model-supplied id", async () => {
    const tool = buildNavigateTools(toolCtx)[0];
    // The model can only pass `section`; clientId is closed over from ctx.
    await tool.invoke({ section: "overview" });
    expect(emitNavigate).toHaveBeenCalledWith("/clients/c1/overview");
  });

  it("returns an error string and emits NOTHING when emitNavigate rejects", async () => {
    emitNavigate.mockRejectedValueOnce(new Error("navigate href not allowlisted"));
    const tool = buildNavigateTools(toolCtx)[0];
    const out = await tool.invoke({ section: "cashflow" });
    expect(JSON.parse(out)).toHaveProperty("error");
    // emitNavigate was attempted once (and rejected) — no successful navigate.
    expect(JSON.parse(out)).not.toHaveProperty("navigated");
  });

  it("is wired into buildTools (the navigate bundle is assembled)", () => {
    const names = new Set(buildTools(toolCtx).map((t) => t.name));
    expect(names.has("open_page")).toBe(true);
  });

  it("open_page is NON-mutating — NOT in WRITE_TOOL_NAMES (no HITL gate)", () => {
    expect(WRITE_TOOL_NAMES.has("open_page")).toBe(false);
  });
});

describe("cite_page citation tool", () => {
  beforeEach(() => { emitPageLink.mockClear(); });

  const cite = (ctx = toolCtx) =>
    buildNavigateTools(ctx).find((t) => t.name === "cite_page")!;

  it("emits a page_link frame to the resolved path with a server-derived label and confirms", async () => {
    const out = await cite().invoke({ section: "balance-sheet" });
    expect(emitPageLink).toHaveBeenCalledWith(
      "/clients/c1/assets/balance-sheet-report",
      "balance-sheet",
      "Balance Sheet",
    );
    expect(JSON.parse(out)).toMatchObject({ cited: true, section: "balance-sheet" });
  });

  it("resolves an expanded section (income-tax) to its real nested route", async () => {
    await cite().invoke({ section: "income-tax" });
    expect(emitPageLink).toHaveBeenCalledWith(
      "/clients/c1/cashflow/income-tax",
      "income-tax",
      "Income Tax",
    );
  });

  it("builds the path from ctx.clientId, never a model-supplied id", async () => {
    await cite().invoke({ section: "overview" });
    expect(emitPageLink).toHaveBeenCalledWith("/clients/c1/overview", "overview", "Overview");
  });

  it("returns an error string and does not confirm when emitPageLink rejects", async () => {
    emitPageLink.mockRejectedValueOnce(new Error("page_link href not allowlisted"));
    const out = await cite().invoke({ section: "cashflow" });
    expect(JSON.parse(out)).toHaveProperty("error");
    expect(JSON.parse(out)).not.toHaveProperty("cited");
  });

  it("cite_page is NON-mutating — NOT in WRITE_TOOL_NAMES (no HITL gate)", () => {
    expect(WRITE_TOOL_NAMES.has("cite_page")).toBe(false);
  });
});
