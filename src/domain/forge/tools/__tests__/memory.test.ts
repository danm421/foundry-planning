import { describe, it, expect, vi, beforeEach } from "vitest";

const put = vi.fn();
const get = vi.fn();
const search = vi.fn();
vi.mock("../../store", () => ({
  getStore: () => ({ put, get, search }),
}));

import { buildMemoryTools } from "../memory";
import { WRITE_TOOL_NAMES } from "../index";
import type { ForgeToolContext } from "../../context";

// ForgeToolContext nests the auth scope under `ctx`.
const toolCtx: ForgeToolContext = {
  ctx: { userId: "u1", firmId: "f1", clientId: "c1", scenarioId: "base" },
  conversationId: "conv_1",
};

describe("memory tools", () => {
  beforeEach(() => {
    put.mockReset();
    get.mockReset();
    search.mockReset();
  });

  it("write_memory persists under the [firmId, clientId] namespace", async () => {
    const tools = buildMemoryTools(toolCtx);
    const write = tools.find((t) => t.name === "write_memory")!;
    await write.invoke({ scope: "client", key: "risk_pref", value: "conservative" });
    expect(put).toHaveBeenCalledWith(["f1", "c1"], "risk_pref", { value: "conservative" });
  });

  it("write_memory under the advisor scope uses [firmId, userId]", async () => {
    const tools = buildMemoryTools(toolCtx);
    const write = tools.find((t) => t.name === "write_memory")!;
    await write.invoke({ scope: "advisor", key: "tone", value: "formal" });
    expect(put).toHaveBeenCalledWith(["f1", "u1"], "tone", { value: "formal" });
  });

  it("read_memory searches the [firmId, clientId] namespace", async () => {
    search.mockResolvedValue([]);
    const tools = buildMemoryTools(toolCtx);
    const read = tools.find((t) => t.name === "read_memory")!;
    await read.invoke({ scope: "client", query: "risk" });
    expect(search).toHaveBeenCalledWith(["f1", "c1"], expect.objectContaining({ query: "risk" }));
  });

  it("write_memory is NOT an approval-gated write tool", () => {
    expect(WRITE_TOOL_NAMES.has("write_memory")).toBe(false);
  });
});
