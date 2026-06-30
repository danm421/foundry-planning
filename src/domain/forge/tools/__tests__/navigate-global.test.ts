import { describe, it, expect, vi, beforeEach } from "vitest";

const { emitNavigate, emitPageLink } = vi.hoisted(() => ({
  emitNavigate: vi.fn(async () => {}),
  emitPageLink: vi.fn(async () => {}),
}));

vi.mock("../../custom-events", () => ({ emitNavigate, emitPageLink }));

import { buildGlobalNavigateTools } from "../navigate-global";

const toolCtx = { ctx: { userId: "u1", firmId: "f1" }, conversationId: "c1" };

describe("global navigate tools", () => {
  beforeEach(() => { emitNavigate.mockClear(); emitPageLink.mockClear(); });

  it("open_page resolves the topic href and navigates", async () => {
    const open = buildGlobalNavigateTools(toolCtx).find((t) => t.name === "open_page")!;
    const out = JSON.parse(String(await open.invoke({ topicId: "add-household" })));
    expect(out.navigated).toBe(true);
    expect(emitNavigate).toHaveBeenCalledWith("/crm/new");
  });

  it("cite_page attaches a link chip without navigating", async () => {
    const cite = buildGlobalNavigateTools(toolCtx).find((t) => t.name === "cite_page")!;
    await cite.invoke({ topicId: "add-household" });
    expect(emitPageLink).toHaveBeenCalledWith("/crm/new", "add-household", "Add a new client or household");
    expect(emitNavigate).not.toHaveBeenCalled();
  });

  it("unknown topic returns an error, never throws", async () => {
    const open = buildGlobalNavigateTools(toolCtx).find((t) => t.name === "open_page")!;
    const out = String(await open.invoke({ topicId: "nope" }));
    expect(out).toMatch(/could not/i);
  });
});
