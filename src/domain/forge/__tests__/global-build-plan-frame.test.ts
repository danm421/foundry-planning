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
// plan-builder-core's DB work (ensurePlanImport, findImportTargetName) is
// stubbed, so the emit call site under test is the shipping one. Kept out of approval-node-custom-events.test.ts because that
// file mocks WRITE_TOOL_NAMES, which would route build_plan around HITL entirely.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver, Command } from "@langchain/langgraph";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/imports/plan-builder-core", () => ({
  ensurePlanImport: vi.fn(),
  findImportTargetName: vi.fn(),
}));
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
import { ensurePlanImport, findImportTargetName } from "@/lib/imports/plan-builder-core";
import { formatProposedWrite, describeProposedWrite } from "../preview";
import type { WritePreview } from "../types";
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
      householdName: "Nguyen Household",
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

// Global attach-first ingest. The model picks both the mode and, for an
// update, which existing household — so the approval card has to say which in
// plain words, naming the household the server resolves from clientId with the
// same access rule the import itself runs under.
const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";
const HOUSEHOLD_NAMES: Record<string, string> = {
  [CLIENT_A]: "Jones Household",
  [CLIENT_B]: "Jones-Smith Household",
};

const UPDATE_B_CALL = {
  id: "call_ff",
  name: "ingest_fact_finder",
  args: { mode: "updating", clientId: CLIENT_B },
};

const ATTACHED_TURN = [
  "[Attached fact finder]",
  "household: Jones Household",
  "primary: Pat Jones (1970-01-01)",
  `Possible existing matches: Jones Household (clientId: ${CLIENT_A}); Jones-Smith Household (clientId: ${CLIENT_B})`,
].join("\n");

function cardText(p: WritePreview): string {
  return [p.summary, ...(p.details ?? [])].join("\n");
}

describe("global ingest_fact_finder — the approval card says what will happen and to which household", () => {
  beforeEach(() => {
    vi.mocked(findImportTargetName).mockImplementation(async (id: string) => HOUSEHOLD_NAMES[id] ?? null);
    vi.mocked(ensurePlanImport).mockImplementation(async (a) => ({
      clientId: a.existing?.clientId ?? "client_new",
      scenarioId: "base",
      importId: "import_ff",
    }));
  });

  it("names the create mode and the new household's details", () => {
    const text = cardText(
      formatProposedWrite({
        name: "ingest_fact_finder",
        args: {
          mode: "new",
          householdName: "Jones Household",
          primaryFirstName: "Pat",
          primaryLastName: "Jones",
          primaryDob: "1970-01-01",
          state: "OH",
        },
      }),
    );
    expect(text).toMatch(/create a new household/i);
    expect(text).toContain("Jones Household");
    expect(text).toContain("Pat Jones");
    expect(text).toContain("1970-01-01");
  });

  it("names the update mode and the household it resolves from clientId", async () => {
    const preview = await describeProposedWrite(
      { name: "ingest_fact_finder", args: { mode: "updating", clientId: CLIENT_B } },
      globalCtx,
    );
    expect(cardText(preview)).toMatch(/update existing household/i);
    expect(preview.summary).toContain("Jones-Smith Household");
    expect(findImportTargetName).toHaveBeenCalledWith(CLIENT_B, "org_session");
  });

  it("says so plainly when the household can't be found or opened", async () => {
    const preview = await describeProposedWrite(
      { name: "ingest_fact_finder", args: { mode: "updating", clientId: "33333333-3333-4333-8333-333333333333" } },
      globalCtx,
    );
    expect(cardText(preview)).toMatch(/update/i);
    expect(cardText(preview)).toMatch(/can't find that household/i);
  });

  it("the approval interrupt names household B for a scripted update, and the frame carries its name", async () => {
    invoke
      .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [UPDATE_B_CALL] }))
      .mockResolvedValue(new AIMessage("Started the update."));

    const g = buildGraph(globalCtx, new MemorySaver(), "conv-ff", () => "SYSTEM");
    const cfg = { configurable: { thread_id: "conv-ff" }, recursionLimit: 10 };

    await toolRenderFrames(
      g.streamEvents(
        { messages: [new HumanMessage(ATTACHED_TURN)], authContext: globalCtx },
        { ...cfg, version: "v2" },
      ),
    );
    const state = await g.getState(cfg);
    const value = state.tasks.flatMap((t) => t.interrupts)[0]?.value as {
      previews: WritePreview[];
    };
    const card = value.previews.map(cardText).join("\n");
    expect(card).toMatch(/update existing household/i);
    expect(card).toContain("Jones-Smith Household");
    expect(card).not.toContain("Jones Household");
    expect(ensurePlanImport).not.toHaveBeenCalled();

    const resumeFrames = await toolRenderFrames(
      g.streamEvents(new Command({ resume: { decisions: { call_ff: "confirm" } } }), {
        ...cfg,
        version: "v2",
      }),
    );
    expect(ensurePlanImport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "existing", existing: { clientId: CLIENT_B } }),
    );
    expect(resumeFrames.find((f) => f.name === "ingest_fact_finder")?.data).toEqual({
      clientId: CLIENT_B,
      importId: "import_ff",
      mode: "updating",
      householdName: "Jones-Smith Household",
    });
  });
});
