import { describe, it, expect } from "vitest";
import { buildGlobalTools } from "../global-index";

const toolCtx = { ctx: { userId: "u1", firmId: "f1" }, conversationId: "c1" };

describe("buildGlobalTools", () => {
  it("contains ONLY help + global-navigate tools", () => {
    const names = buildGlobalTools(toolCtx).map((t) => t.name).sort();
    expect(names).toEqual(["cite_page", "get_help", "open_page", "search_help"]);
  });

  it("contains NO client-scoped tool", () => {
    const names = new Set(buildGlobalTools(toolCtx).map((t) => t.name));
    for (const clientTool of ["run_projection", "add_expense", "crm_add_note", "propose_changes"]) {
      expect(names.has(clientTool)).toBe(false);
    }
  });
});
