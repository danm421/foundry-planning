// src/domain/mcp/__tests__/whatif-parity.test.ts
//
// Spec, Testing → Parity: the same changes through try_what_if and through the
// Solver screen's own projection route give the same numbers. The route is the
// real one; only its IO (session, rate limit, loader) is replaced, and both
// sides start from the same fixture tree.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ loadEffectiveTree: vi.fn(), buildRunDeps: vi.fn() }));

vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: h.loadEffectiveTree }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn().mockResolvedValue("org_1") }));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, firmId: "org_1" }),
  verifyClientAccessFor: vi.fn().mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
  rateLimitErrorResponse: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../whatif-jobs", () => ({
  buildRunDeps: h.buildRunDeps,
  chargeCompute: vi.fn().mockResolvedValue(undefined),
  startWhatIfJob: vi.fn(),
}));

import { POST as solverProject } from "@/app/api/clients/[id]/solver/project/route";
import { whatifTools } from "../tools/whatif";
import type { ProjectionYear } from "@/engine/types";
import { parseProjectionResponse } from "@/lib/solver/projection-wire";
import { lifetimeTaxes, yearsFullyFunded } from "@/lib/solver/solver-summary-metrics";
import type { WhatIfChange } from "@/lib/whatif/changes";
import type { MetricKey } from "@/lib/whatif/metrics";
import { translateChanges } from "@/lib/whatif/translate";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { IDS, whatIfTree } from "@/lib/whatif/__tests__/fixtures";

const principal: McpPrincipal = { userId: "u1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "u1" };
const CLIENT = "00000000-0000-4000-8000-000000000001";

// Each of these moves this fixture's numbers on its own (asserted below), so
// a what-if that silently dropped one would fail the parity check.
const changes: WhatIfChange[] = [
  { type: "retirement_age", person: "client", age: 62 },
  { type: "expense_amount", expenseId: IDS.living, annualAmount: 70_000 },
  { type: "income_amount", incomeId: IDS.salaryJane, annualAmount: 90_000 },
];

/** try_what_if reports dollar figures to the cent. */
const cents = (n: number) => Math.round(n * 100) / 100;

type TryOut = {
  result: {
    whatIf: { endingPortfolio: number; lifetimeTax: number; yearsFullyFunded: number };
    deltas: Partial<Record<MetricKey, number>>;
  };
};
const tryWhatIf = async (c: WhatIfChange[]) =>
  (await whatifTools.find((t) => t.name === "try_what_if")!.run({ clientId: CLIENT, changes: c }, principal)) as TryOut;

beforeEach(() => {
  h.loadEffectiveTree.mockImplementation(async () => ({ effectiveTree: whatIfTree(), warnings: [] }));
  h.buildRunDeps.mockImplementation(async () => ({
    tree: whatIfTree(),
    loadMcPayload: vi.fn(),
    monteCarloSuccess: vi.fn(),
    now: () => 0,
  }));
});

describe("try_what_if matches the Solver screen", () => {
  it("uses changes that each move the numbers, so the parity check can fail", async () => {
    for (const change of changes) {
      const { deltas } = (await tryWhatIf([change])).result;
      const moved = (["endingPortfolio", "lifetimeTax", "yearsFullyFunded"] as const).some((k) => (deltas[k] ?? 0) !== 0);
      expect(moved, `${change.type} alone should change at least one compared figure`).toBe(true);
    }
  });

  it("gives the same ending portfolio, lifetime tax and funded years as the Solver's projection route", async () => {
    // These three changes create no records, so their translation is the same on every call.
    const { mutations } = translateChanges(whatIfTree(), changes);
    const res = await solverProject(
      new Request(`http://t/api/clients/${CLIENT}/solver/project`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "base", mutations, includeEvents: true }),
      }) as never,
      { params: Promise.resolve({ id: CLIENT }) },
    );
    expect(res.status).toBe(200);
    const years = parseProjectionResponse<{ projection: ProjectionYear[] }>(await res.text()).projection;

    const out = await tryWhatIf(changes);
    expect(out.result.whatIf.endingPortfolio).toBe(cents(years.at(-1)!.portfolioAssets.liquidTotal));
    expect(out.result.whatIf.lifetimeTax).toBe(cents(lifetimeTaxes(years)));
    expect(out.result.whatIf.yearsFullyFunded).toBe(yearsFullyFunded(years));
  });
});
