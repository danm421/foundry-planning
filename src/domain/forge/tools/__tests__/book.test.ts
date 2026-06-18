import { describe, it, expect, vi } from "vitest";
import { buildBookTools } from "../book";
import { buildToolContext, type ForgeAuthContext } from "../../context";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "org_A") }));
const { scanBookMock } = vi.hoisted(() => ({
  scanBookMock: vi.fn(async () => ({ rows: [], totalCount: 0, truncated: false })),
}));
// Partial mock: stub scanBook (no DB), keep the real SIGNAL_KEYS / limit
// constants that book.ts reads when building the tool schema.
vi.mock("@/lib/book-scan/scan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/book-scan/scan")>()),
  scanBook: scanBookMock,
}));

const ctx: ForgeAuthContext = { userId: "u_advisor", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const TOOL_CTX = buildToolContext(ctx, "conv-1");

describe("scan_book tool", () => {
  it("exposes exactly one read tool named scan_book", () => {
    const tools = buildBookTools(TOOL_CTX);
    expect(tools.map((t) => t.name)).toEqual(["scan_book"]);
  });

  it("passes server-derived firmId + advisorId (ctx.userId) to scanBook", async () => {
    const tool = buildBookTools(TOOL_CTX)[0];
    await tool.invoke({ sortBy: "cashBalance", direction: "desc", limit: 5 });
    expect(scanBookMock).toHaveBeenCalledWith(
      { firmId: "org_A", advisorId: "u_advisor" },
      expect.objectContaining({ sortBy: "cashBalance", direction: "desc", limit: 5 }),
    );
  });
});
