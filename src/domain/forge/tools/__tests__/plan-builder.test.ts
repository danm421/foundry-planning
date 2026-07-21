import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "org_A") }));
vi.mock("../../guards", () => ({ assertClientReadable: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
const { row, state, ensurePlanImportMock, gateAccessMock } = vi.hoisted(() => ({
  row: { status: "review", payloadJson: {} as unknown },
  state: { found: true },
  ensurePlanImportMock: vi.fn(async () => ({ clientId: "c1", scenarioId: "s1", importId: "imp1" })),
  gateAccessMock: vi.fn(
    async (): Promise<{ firmId: string } | { error: string }> => ({ firmId: "org_A" }),
  ),
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => (state.found ? [row] : [])) })),
      })),
    })),
  },
}));
vi.mock("@/lib/imports/plan-builder-core", () => ({ ensurePlanImport: ensurePlanImportMock }));
vi.mock("../scenario-writes", () => ({ gateAccess: gateAccessMock, buildScenarioWriteTools: vi.fn(() => []) }));

import { buildPlanBuilderTools } from "../plan-builder";
import { buildToolContext, type ForgeAuthContext } from "../../context";
import { WRITE_TOOL_NAMES } from "../index";

const ctx: ForgeAuthContext = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const TOOL_CTX = buildToolContext(ctx, "conv-1");

describe("get_plan_status tool", () => {
  it("exposes get_plan_status + build_plan", () => {
    expect(buildPlanBuilderTools(TOOL_CTX).map((t) => t.name)).toEqual(["get_plan_status", "build_plan"]);
  });

  it("returns unanswered questions + reviewPath from the assemble state", async () => {
    row.payloadJson = {
      assemble: {
        version: 1,
        mergedFileCount: 1,
        assumptions: [],
        questions: [
          { id: "q:primary_dob", kind: "identity", field: "client.primaryDob", prompt: "?", answer: "1975-01-01" },
          { id: "q:retirement_age", kind: "assumption", field: "client.retirementAge", prompt: "?" },
        ],
      },
    };
    const out = JSON.parse(await buildPlanBuilderTools(TOOL_CTX)[0].invoke({ importId: "imp1" }));
    expect(out.questionCount).toBe(2);
    expect(out.unanswered.map((q: { id: string }) => q.id)).toEqual(["q:retirement_age"]);
    expect(out.reviewPath).toBe("/clients/c1/details/import/imp1");
    expect(out.status).toBe("review");
  });

  it("returns a JSON error string, not a throw, when the import is out of scope", async () => {
    state.found = false;
    const out = JSON.parse(await buildPlanBuilderTools(TOOL_CTX)[0].invoke({ importId: "imp-other-client" }));
    expect(out).toEqual({ error: "Import not found for this client." });
    state.found = true;
  });
});

describe("build_plan tool (mode existing)", () => {
  it("calls ensurePlanImport with mode existing + the current client, returns JSON with importId", async () => {
    const buildPlan = buildPlanBuilderTools(TOOL_CTX)[1];
    const out = JSON.parse(await buildPlan.invoke({}));
    expect(gateAccessMock).toHaveBeenCalledWith("c1");
    expect(ensurePlanImportMock).toHaveBeenCalledWith({
      mode: "existing",
      firmId: "org_A",
      actorUserId: "u1",
      existing: { clientId: "c1" },
    });
    expect(out).toEqual({ clientId: "c1", importId: "imp1", mode: "existing" });
  });

  it("returns the gate's error string, not a throw, when access is denied", async () => {
    gateAccessMock.mockResolvedValueOnce({ error: "Client not found or access denied." });
    const buildPlan = buildPlanBuilderTools(TOOL_CTX)[1];
    const out = await buildPlan.invoke({});
    expect(out).toBe("Client not found or access denied.");
  });

  it("is registered in WRITE_TOOL_NAMES (HITL-gated)", () => {
    expect(WRITE_TOOL_NAMES.has("build_plan")).toBe(true);
  });

  it("get_plan_status is NOT in WRITE_TOOL_NAMES (read-only)", () => {
    expect(WRITE_TOOL_NAMES.has("get_plan_status")).toBe(false);
  });
});
