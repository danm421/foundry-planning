import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "org_A") }));
vi.mock("../../guards", () => ({ assertClientReadable: vi.fn(async () => {}) }));
const { row } = vi.hoisted(() => ({
  row: { status: "review", payloadJson: {} as unknown },
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [row]) })),
      })),
    })),
  },
}));

import { buildPlanBuilderTools } from "../plan-builder";
import { buildToolContext, type ForgeAuthContext } from "../../context";

const ctx: ForgeAuthContext = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const TOOL_CTX = buildToolContext(ctx, "conv-1");

describe("get_plan_status tool", () => {
  it("exposes exactly one tool named get_plan_status", () => {
    expect(buildPlanBuilderTools(TOOL_CTX).map((t) => t.name)).toEqual(["get_plan_status"]);
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
});
