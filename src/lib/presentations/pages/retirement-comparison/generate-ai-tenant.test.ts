// Whose Azure tenant the Retirement Comparison commentary runs in when the
// client belongs to ANOTHER firm (a cross-firm share). Unlike the sibling
// generate-ai.test.ts, the real azure-client and credential resolver run here —
// only the `openai` SDK, Clerk, and the connection rows are faked — so the
// assertions read which endpoint actually served the call.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getConnection: vi.fn(),
  /** The options of every AzureOpenAI client that served a completion. */
  served: [] as Array<{ endpoint?: string; apiKey?: string }>,
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/integrations/connections", () => ({
  getConnection: (firmId: string, provider: string) => h.getConnection(firmId, provider),
  setConnectionStatus: vi.fn(),
}));
// The row's blobs name the firm, so each firm's resource is told apart by URL.
vi.mock("@/lib/ai/credentials", () => ({
  decodeAzureSecret: (blob: string) => ({ apiKey: `key-${blob}` }),
  decodeAzureConfig: (scope: string) => ({
    endpoint: `https://${scope}.openai.azure.com`,
    apiVersion: "2024-12-01-preview",
    chatDeployment: "chat",
    miniDeployment: "mini",
    embeddingDeployment: "embed",
  }),
}));
vi.mock("openai", () => ({
  AzureOpenAI: class {
    chat: unknown;
    constructor(opts: { endpoint?: string; apiKey?: string }) {
      this.chat = {
        completions: {
          create: async () => {
            h.served.push({ endpoint: opts.endpoint, apiKey: opts.apiKey });
            return { choices: [{ message: { content: " drafted " }, finish_reason: "stop" }], usage: {} };
          },
        },
      };
    }
  },
}));

// Everything upstream of the prompt — same stubs as generate-ai.test.ts.
vi.mock("@/lib/compute-cache/monte-carlo", () => ({
  getOrComputeMonteCarlo: vi.fn(async () => ({
    payload: { summary: { successRate: 0.8, ending: { p20: 1 } } },
    raw: {},
    meta: { startingLiquidBalance: 0 },
  })),
}));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTreeForRef: vi.fn(async () => ({
    effectiveTree: {
      client: { firstName: "T", lastName: "U", spouseName: null, dateOfBirth: "1970-01-01", retirementAge: 65 },
      planSettings: {},
    },
  })),
}));
vi.mock("@/lib/scenario/presentation-refs", () => ({
  resolveScenarioRef: (raw: string) =>
    raw === "base" ? { kind: "base" } : { kind: "scenario", id: raw },
}));
vi.mock("@/engine/projection", () => ({ runProjectionWithEvents: () => ({ years: [] }) }));
vi.mock("@/lib/compute-cache/max-spending", () => ({
  getOrComputeMaxSpending: vi.fn(async () => ({ realAnnualSpend: 100 })),
}));
vi.mock("@/lib/scenario/changes", () => ({
  loadScenarioChanges: vi.fn(async () => []),
  loadScenarioToggleGroups: vi.fn(async () => []),
}));
vi.mock("@/lib/scenario/load-panel-data", () => ({ buildTargetNames: () => ({}) }));
vi.mock("@/lib/scenario/scenario-change-describe", () => ({ describeChangeUnit: () => "" }));
vi.mock("./metrics", () => ({ buildRetirementComparisonMetrics: () => ({ kpis: [], matrix: [] }) }));
vi.mock("./ai-prompt", () => ({ buildRetirementComparisonAiPrompt: () => ({ system: "sys", user: "usr" }) }));
vi.mock("@/lib/presentations/ai-cache", () => ({
  hashAiRequest: () => "HASH",
  getCachedAnalysis: vi.fn(async () => null),
  setCachedAnalysis: vi.fn(async () => {}),
}));
vi.mock("@/db/schema", () => ({ scenarios: { id: "id", clientId: "clientId", name: "name" } }));
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}) }));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}));

import { generateRetirementComparisonAi } from "./generate-ai";
import { clearAiCredentialCache } from "@/lib/ai/resolve";

const REFUSAL =
  "AI features aren't available on a client shared from a firm that uses its own AI connection.";

/** A row as getConnection returns it; `blob` names the firm's resource. */
function row(status: "connected" | "error" | "disconnected", blob: string) {
  return { status, accessToken: blob, scope: blob };
}

/** Firm A owns the client. Firm B is the caller unless a test says otherwise. */
function connections(byFirm: Record<string, ReturnType<typeof row> | null>) {
  h.getConnection.mockImplementation(async (firmId: string) => byFirm[firmId] ?? null);
}

const generate = () =>
  generateRetirementComparisonAi({
    clientId: "c1",
    firmId: "org_a",
    scenarioId: "scn1",
    baselineScenarioId: "base",
    tone: "concise",
    length: "short",
    customInstructions: "",
    targetConfidence: 0.85,
    force: true,
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.served.length = 0;
  clearAiCredentialCache();
  h.auth.mockResolvedValue({ userId: "user_b", orgId: "org_b" });
  vi.stubEnv("AZURE_ENDPOINT", "https://foundry.openai.azure.com");
  vi.stubEnv("AZURE_API_KEY", "key-foundry");
  vi.stubEnv("AZURE_ANALYSIS_MODEL", "gpt-5.4");
  vi.stubEnv("AZURE_MODEL", "gpt-5.4-mini");
});

afterEach(() => vi.unstubAllEnvs());

describe("generateRetirementComparisonAi on a client from another firm", () => {
  it("refuses when the owning firm runs AI in its own tenant, and calls no model", async () => {
    connections({ org_a: row("connected", "firm-a"), org_b: null });

    await expect(generate()).rejects.toThrow(REFUSAL);
    expect(h.served).toEqual([]);
  });

  it("refuses an owning firm whose connection is in error too — it still opted in", async () => {
    connections({ org_a: row("error", "firm-a"), org_b: row("connected", "firm-b") });

    await expect(generate()).rejects.toThrow(REFUSAL);
    expect(h.served).toEqual([]);
  });

  it("runs in Foundry's tenant, never the caller's own, when the owning firm has none", async () => {
    connections({ org_a: null, org_b: row("connected", "firm-b") });

    await generate();

    expect(h.served).toEqual([{ endpoint: "https://foundry.openai.azure.com", apiKey: "key-foundry" }]);
  });

  it("a caller in the owning firm keeps that firm's own tenant", async () => {
    h.auth.mockResolvedValue({ userId: "user_a", orgId: "org_a" });
    connections({ org_a: row("connected", "firm-a"), org_b: row("connected", "firm-b") });

    await generate();

    expect(h.served).toEqual([{ endpoint: "https://firm-a.openai.azure.com", apiKey: "key-firm-a" }]);
  });
});
