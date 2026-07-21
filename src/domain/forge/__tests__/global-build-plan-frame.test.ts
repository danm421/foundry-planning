// src/domain/forge/__tests__/global-build-plan-frame.test.ts
//
// The flagship plan-builder path, pinned end-to-end on the server side.
//
// Approving `build_plan` in a GLOBAL (clientless) thread must ship a
// `tool_render` frame carrying { clientId, importId, mode }. That frame is the
// ONLY channel by which the panel learns the ids it just minted — tool RESULTS
// go to the model, not the browser. No frame → no attach-files paperclip → the
// documents-to-plan flow dead-ends at the approval card with a draft import
// stranded in the DB and no resume affordance.
//
// Nothing covered this before: the approval node is the one execution path that
// does NOT run through `toolsNode`, and every existing approval test asserted
// audits and tool messages, never the stream.
//
// The REAL global tool set is built here (buildGlobalTools is not mocked) — only
// ensurePlanImport's persistence is stubbed, so the emit call site under test is
// the shipping one. Kept out of approval-node-custom-events.test.ts because that
// file mocks WRITE_TOOL_NAMES, which would route build_plan around HITL entirely.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver, Command } from "@langchain/langgraph";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/imports/plan-builder-core", () => ({ ensurePlanImport: vi.fn() }));
vi.mock("@/lib/crm/households", () => ({
  listCrmHouseholds: vi.fn(),
  getCrmHousehold: vi.fn(),
  createCrmHousehold: vi.fn(),
}));
vi.mock("@/lib/clients/create-client", () => ({ createClientForHousehold: vi.fn() }));
vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: vi.fn() }));

const invoke = vi.fn();
vi.mock("../llm", () => ({ chatModel: () => ({ bindTools: () => ({ invoke }) }) }));

import { buildGraph } from "../graph";
import type { ForgeGlobalAuthContext } from "../state";
import { requireOrgId } from "@/lib/db-helpers";
import { ensurePlanImport } from "@/lib/imports/plan-builder-core";
import { toolRenderFrames } from "./custom-event-helpers";

const globalCtx: ForgeGlobalAuthContext = { userId: "user_1", firmId: "org_session" };

const BUILD_PLAN_CALL = {
  id: "call_bp",
  name: "build_plan",
  args: {
    householdName: "Nguyen Household",
    state: "CA",
    primaryFirstName: "Anh",
    primaryLastName: "Nguyen",
    primaryDob: "1968-03-14",
    filingStatus: "single",
    retirementAge: 65,
    lifeExpectancy: 92,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockReset();
  vi.mocked(requireOrgId).mockResolvedValue("org_session");
  vi.mocked(ensurePlanImport).mockResolvedValue({
    clientId: "client_new",
    importId: "import_new",
  } as Awaited<ReturnType<typeof ensurePlanImport>>);
});

describe("global build_plan — the approved write's tool_render frame reaches the stream", () => {
  it("emits { clientId, importId, mode } on confirm — the paperclip's only input", async () => {
    invoke
      .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [BUILD_PLAN_CALL] }))
      .mockResolvedValue(new AIMessage("Started the build — drop the statements in."));

    const g = buildGraph(globalCtx, new MemorySaver(), "conv-bp", () => "SYSTEM");
    const cfg = { configurable: { thread_id: "conv-bp" }, recursionLimit: 10 };

    const proposeFrames = await toolRenderFrames(
      g.streamEvents(
        { messages: [new HumanMessage("build a plan for the Nguyens")], authContext: globalCtx },
        { ...cfg, version: "v2" },
      ),
    );
    // Held at the interrupt: nothing minted, nothing streamed, while the
    // advisor is still deciding.
    expect(proposeFrames).toEqual([]);
    expect(ensurePlanImport).not.toHaveBeenCalled();

    const resumeFrames = await toolRenderFrames(
      g.streamEvents(new Command({ resume: { decisions: { call_bp: "confirm" } } }), {
        ...cfg,
        version: "v2",
      }),
    );

    expect(ensurePlanImport).toHaveBeenCalledTimes(1);
    const buildFrame = resumeFrames.find((f) => f.name === "build_plan");
    expect(buildFrame).toBeDefined();
    // forge-panel drops any frame missing one of these three rather than
    // crashing, so assert the exact shape the consumer validates — a frame that
    // arrives malformed is indistinguishable from no frame at all.
    expect(buildFrame!.data).toEqual({
      clientId: "client_new",
      importId: "import_new",
      mode: "new",
    });
  });

  it("emits no frame and mints nothing on reject", async () => {
    invoke
      .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [BUILD_PLAN_CALL] }))
      .mockResolvedValue(new AIMessage("No problem — cancelled."));

    const g = buildGraph(globalCtx, new MemorySaver(), "conv-bp-reject", () => "SYSTEM");
    const cfg = { configurable: { thread_id: "conv-bp-reject" }, recursionLimit: 10 };

    await toolRenderFrames(
      g.streamEvents(
        { messages: [new HumanMessage("build a plan for the Nguyens")], authContext: globalCtx },
        { ...cfg, version: "v2" },
      ),
    );
    const resumeFrames = await toolRenderFrames(
      g.streamEvents(new Command({ resume: { decisions: { call_bp: "reject" } } }), {
        ...cfg,
        version: "v2",
      }),
    );

    expect(resumeFrames.find((f) => f.name === "build_plan")).toBeUndefined();
    expect(ensurePlanImport).not.toHaveBeenCalled();
  });
});
