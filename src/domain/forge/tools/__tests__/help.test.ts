import { describe, it, expect } from "vitest";
import { buildHelpTools } from "../help";

const toolCtx = { ctx: { userId: "u1", firmId: "f1" }, conversationId: "c1" };

describe("help tools", () => {
  it("exposes search_help and get_help", () => {
    const names = buildHelpTools(toolCtx).map((t) => t.name).sort();
    expect(names).toEqual(["get_help", "search_help"]);
  });

  it("search_help returns matching topics as JSON", async () => {
    const tools = buildHelpTools(toolCtx);
    const search = tools.find((t) => t.name === "search_help")!;
    const out = JSON.parse(String(await search.invoke({ query: "new household" })));
    expect(out.topics.map((t: { id: string }) => t.id)).toContain("add-household");
  });

  it("get_help returns a topic's steps + href", async () => {
    const tools = buildHelpTools(toolCtx);
    const get = tools.find((t) => t.name === "get_help")!;
    const out = JSON.parse(String(await get.invoke({ topicId: "add-household" })));
    expect(out.topic.href).toBe("/crm/new");
    expect(out.topic.steps.length).toBeGreaterThan(0);
  });

  it("get_help on an unknown id returns an error string, never throws", async () => {
    const tools = buildHelpTools(toolCtx);
    const get = tools.find((t) => t.name === "get_help")!;
    const out = String(await get.invoke({ topicId: "does-not-exist" }));
    expect(out).toMatch(/not found/i);
  });
});
