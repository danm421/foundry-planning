// src/domain/copilot/__tests__/preview-fidelity.test.ts
//
// Preview fidelity: the field-level diff line `describeProposedWrite` shows for a
// propose_changes EDIT must agree with the ACTUAL write's row diff. We compute
// the preview, then perform the real write via `applyEntityEdit`, re-read the
// effective tree, and assert the engine's `computeRowDiff` of base→after carries
// the same field + value the preview surfaced.
//
// Skips cleanly without a DB (no DATABASE_URL) so it never adds to the no-delta
// failing set in CI. Mirrors changes-writer.test.ts's Cooper-fixture setup.
//
// promote_to_base enrichment tests (no DB required) are at the bottom of this
// file. They use vi.spyOn per-test so module-level imports remain real, which
// keeps the DB fidelity test fully functional when DATABASE_URL is set.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// scenarioChangesToBaseWrites is a PURE function — mock it at module level so
// the promote tests can control its output. It is never called by the DB test.
vi.mock("@/lib/scenario/scenario-changes-to-base-writes", () => ({
  scenarioChangesToBaseWrites: vi.fn(),
}));

import { formatProposedWrite } from "../preview";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { describeProposedWrite } from "../preview";
import type { ProposedWrite } from "../preview";
import type { CopilotAuthContext } from "@/domain/copilot/state";
import { applyEntityEdit } from "@/lib/scenario/changes-writer";
import { computeRowDiff } from "@/lib/scenario/diff-row";
import * as loaderModule from "@/lib/scenario/loader";
// Non-cached effective-tree read primitives. loadEffectiveTree is wrapped in
// React cache(), so a second call with the same scenarioId returns the stale
// PRE-write tree. We reconstruct the loader's non-base path from its exported,
// non-cached pieces for the post-write read: loadScenarioChanges re-queries the
// DB so the new edit is reflected; loadClientDataWithContext is cached but the
// BASE tree is unchanged by a scenario-change write, so reusing it is correct.
import { applyScenarioChangesWithRefs, resolveAddPayload } from "@/lib/scenario/loader";
import { loadClientDataWithContext } from "@/lib/projection/load-client-data";
import * as changesModule from "@/lib/scenario/changes";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { scenarioChangesToBaseWrites } from "@/lib/scenario/scenario-changes-to-base-writes";
import type { ClientData } from "@/engine/types";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const COOPER_SALARY_INCOME_ID = "d99f3ccb-8eb5-44f9-ae81-f52fb2694458";

const HAS_DB = !!process.env.DATABASE_URL;

/** Re-read the effective tree WITHOUT React cache(), so it reflects writes. */
async function readEffectiveTreeUncached(
  clientId: string,
  firmId: string,
  scenarioId: string,
): Promise<ClientData> {
  const { clientData: baseTree, resolutionContext } =
    await loadClientDataWithContext(clientId, firmId);
  const [rawChanges, groups] = await Promise.all([
    loadScenarioChanges(scenarioId),
    loadScenarioToggleGroups(scenarioId),
  ]);
  const resolved = rawChanges.map((c) => resolveAddPayload(c, resolutionContext));
  const { effectiveTree } = applyScenarioChangesWithRefs(
    baseTree,
    resolved,
    {},
    groups,
    resolutionContext,
  );
  return effectiveTree;
}

function findIncome(tree: ClientData, id: string): Record<string, unknown> | null {
  return (tree.incomes ?? []).find((i) => i.id === id) as
    | Record<string, unknown>
    | undefined ?? null;
}

describe.skipIf(!HAS_DB)("preview fidelity", () => {
  let scenarioId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `preview-fidelity-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = row.id;
  });

  afterEach(async () => {
    // ON DELETE CASCADE on scenario_changes.scenario_id cleans up child rows.
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  });

  it("propose_changes edit diff line matches the real write's row diff", async () => {
    const NEW_AMOUNT = 275000;

    // (1) Snapshot the base salary income row (no changes yet on this fresh
    // scenario). First loadEffectiveTree call for this scenarioId → no stale
    // cache hit.
    const { effectiveTree: beforeTree } = await loaderModule.loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scenarioId,
      {},
    );
    const beforeRow = findIncome(beforeTree, COOPER_SALARY_INCOME_ID);
    expect(beforeRow).not.toBeNull();
    // Establish that the write actually changes something.
    expect(beforeRow!.annualAmount).not.toBe(NEW_AMOUNT);

    // (2) Build the preview for a propose_changes edit of annualAmount.
    const ctx: CopilotAuthContext = {
      userId: "user_test",
      firmId: COOPER_FIRM_ID,
      clientId: COOPER_CLIENT_ID,
      scenarioId,
    };
    const call: ProposedWrite = {
      name: "propose_changes",
      args: {
        scenarioId,
        groupName: "Bump salary",
        changes: [
          {
            opType: "edit",
            targetKind: "income",
            targetId: COOPER_SALARY_INCOME_ID,
            desiredFields: { annualAmount: NEW_AMOUNT },
          },
        ],
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    // (3) Perform the REAL write.
    await applyEntityEdit({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "income",
      targetId: COOPER_SALARY_INCOME_ID,
      desiredFields: { annualAmount: NEW_AMOUNT },
    });

    // (4) Re-read the post-write effective row via the NON-cached path and diff.
    const afterTree = await readEffectiveTreeUncached(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scenarioId,
    );
    const afterRow = findIncome(afterTree, COOPER_SALARY_INCOME_ID);
    expect(afterRow).not.toBeNull();
    // The write genuinely landed: before ≠ after.
    expect(afterRow!.annualAmount).toBe(NEW_AMOUNT);

    const realDiff = computeRowDiff(beforeRow, afterRow);

    // (5) The real write is an edit, and the preview's field-level line agrees.
    expect(realDiff.kind).toBe("edit");
    if (realDiff.kind !== "edit") return; // narrow for TS
    const realField = realDiff.fields.find((f) => f.field === "annualAmount");
    expect(realField).toBeDefined();

    expect(preview.details).toBeDefined();
    const detailText = preview.details!.join(" ");
    expect(detailText).toContain("annualAmount");
    expect(detailText).toContain(String(realField!.to));
  });
});

describe("CRM Tier-B previews", () => {
  it("crm_delete_note → Delete note summary naming the tool", () => {
    const p = formatProposedWrite({ name: "crm_delete_note", args: { noteId: "n1" } });
    expect(p.name).toBe("crm_delete_note"); expect(p.summary).toMatch(/delete note/i);
  });
  it("crm_delete_task → Delete task summary", () => {
    const p = formatProposedWrite({ name: "crm_delete_task", args: { taskId: "t1" } });
    expect(p.summary).toMatch(/delete task/i);
  });
  it("crm_create_tasks → 'Create N tasks' with the count", () => {
    const p = formatProposedWrite({ name: "crm_create_tasks", args: { tasks: [{ title: "A" }, { title: "B" }, { title: "C" }] } });
    expect(p.summary).toMatch(/create 3 task/i);
  });
});

// ---------------------------------------------------------------------------
// promote_to_base card enrichment (no DB required)
// ---------------------------------------------------------------------------
// Uses vi.spyOn per-test (not vi.mock at module level) for loadEffectiveTree,
// loadScenarioChanges, and loadScenarioToggleGroups — so the DB fidelity test
// above continues to use the real implementations when DATABASE_URL is set.
// scenarioChangesToBaseWrites is a pure function mocked at module level (safe
// because the DB fidelity test never calls it).

describe("promote_to_base card enrichment", () => {
  const ctx: CopilotAuthContext = {
    userId: "user_test",
    firmId: "firm_1",
    clientId: "client_1",
    scenarioId: "s1",
  };

  const FAKE_BASE_PLAN = {
    inserts: [{ kind: "income" as const, targetId: "new-1", raw: {} }],
    updates: [{ kind: "expense" as const, id: "exp-1", set: {} }],
    singletonUpdates: [],
    removes: [{ kind: "liability" as const, id: "liab-1", cascade: false }],
  };

  let spyLoadEffectiveTree: ReturnType<typeof vi.spyOn>;
  let spyLoadScenarioChanges: ReturnType<typeof vi.spyOn>;
  let spyLoadScenarioToggleGroups: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spyLoadEffectiveTree = vi.spyOn(loaderModule, "loadEffectiveTree").mockResolvedValue(
      { effectiveTree: { incomes: [], expenses: [] } } as unknown as Awaited<ReturnType<typeof loaderModule.loadEffectiveTree>>,
    );
    spyLoadScenarioChanges = vi.spyOn(changesModule, "loadScenarioChanges").mockResolvedValue([]);
    spyLoadScenarioToggleGroups = vi.spyOn(changesModule, "loadScenarioToggleGroups").mockResolvedValue([]);
    vi.mocked(scenarioChangesToBaseWrites).mockReturnValue(FAKE_BASE_PLAN);
  });

  afterEach(() => {
    spyLoadEffectiveTree.mockRestore();
    spyLoadScenarioChanges.mockRestore();
    spyLoadScenarioToggleGroups.mockRestore();
    vi.mocked(scenarioChangesToBaseWrites).mockReset();
  });

  it("includes one line per BaseWrite, auto-snapshot line, and sibling-delete warning", async () => {
    const call: ProposedWrite = { name: "promote_to_base", args: { scenarioId: "s1" } };
    const result = await describeProposedWrite(call, ctx);

    expect(result.details).toBeDefined();
    const details = result.details!;

    // One line per insert / update / remove
    expect(details.some((l) => l.includes("ADD") && l.includes("income"))).toBe(true);
    expect(details.some((l) => l.includes("EDIT") && l.includes("expense") && l.includes("exp-1"))).toBe(true);
    expect(details.some((l) => l.includes("REMOVE") && l.includes("liability") && l.includes("liab-1"))).toBe(true);

    // Auto-snapshot line
    expect(details.some((l) => /auto-snapshot|snapshotted/i.test(l))).toBe(true);

    // Sibling-deletion warning
    expect(details.some((l) => /warning|deleted/i.test(l))).toBe(true);
  });

  it("degrades to pure summary (no details) when a loader throws", async () => {
    spyLoadScenarioChanges.mockRejectedValue(new Error("DB unavailable"));

    const call: ProposedWrite = { name: "promote_to_base", args: { scenarioId: "s1" } };
    const result = await describeProposedWrite(call, ctx);

    // Falls back to formatProposedWrite output — summary present, details absent
    expect(result.summary).toBeDefined();
    expect(result.details).toBeUndefined();
  });
});
