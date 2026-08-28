import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();

vi.mock("openai", () => {
  class MockAzureOpenAI {
    embeddings = { create };
    constructor() {}
  }
  return { AzureOpenAI: MockAzureOpenAI };
});

// `resolveAiCredentials` is azure-client.ts's own import (and the only async
// one); `clearAiCredentialCache` is what the real connection-status module
// calls. That module is left unmocked on purpose — its LEAVES are stubbed
// instead, so the auth-failure flip below runs the real code rather than a
// stand-in for it. Both leaf stubs are load-bearing: the real
// `@/lib/integrations/connections` reaches `@/db`, and azure-client.ts now
// imports `auth` from Clerk to name the firm whose connection to flip.
const mockResolve = vi.fn();
const mockClearCache = vi.fn();
vi.mock("@/lib/ai/resolve", () => ({
  resolveAiCredentials: () => mockResolve(),
  clearAiCredentialCache: (...a: unknown[]) => mockClearCache(...a),
}));
const mockSetStatus = vi.fn();
vi.mock("@/lib/integrations/connections", () => ({
  setConnectionStatus: (...a: unknown[]) => mockSetStatus(...a),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ orgId: "org_acme" }) }));

const FOUNDRY_CREDS = {
  source: "foundry",
  endpoint: "https://x.openai.azure.com",
  apiKey: "k",
  apiVersion: "2024-10-01",
  deployments: { chat: "gpt-5.4", mini: "gpt-5.4-mini", embedding: "text-embedding-3-small" },
};

describe("callAIEmbedding", () => {
  beforeEach(() => {
    vi.resetModules();
    create.mockReset();
    mockResolve.mockReset().mockResolvedValue(FOUNDRY_CREDS);
    mockSetStatus.mockReset();
    mockClearCache.mockReset();
  });

  it("returns the 1536-dim vector from the Azure client", async () => {
    create.mockResolvedValue({ data: [{ embedding: Array(1536).fill(0.01) }] });
    const { callAIEmbedding } = await import("../azure-client");
    const vec = await callAIEmbedding("irmaa brackets");
    expect(vec).toHaveLength(1536);
    expect(create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "irmaa brackets",
    });
  });

  it("embeds against the FIRM's own deployment when the firm has connected one", async () => {
    // Forge search stores firm rows alongside Foundry Planning's global seed in
    // ONE vector space, so this is the call that must not silently run in our
    // tenant on a connected firm's text.
    mockResolve.mockResolvedValue({
      source: "firm",
      endpoint: "https://acme-ria.openai.azure.com",
      apiKey: "firm-key",
      apiVersion: "2030-01-01",
      deployments: { chat: "firm-chat", mini: "firm-mini", embedding: "firm-embed" },
    });
    create.mockResolvedValue({ data: [{ embedding: Array(1536).fill(0.01) }] });
    const { callAIEmbedding } = await import("../azure-client");
    await callAIEmbedding("irmaa brackets");
    expect(create).toHaveBeenCalledWith({ model: "firm-embed", input: "irmaa brackets" });
  });

  it("fails closed when the resolved credentials name no embedding deployment", async () => {
    mockResolve.mockResolvedValue({
      ...FOUNDRY_CREDS,
      deployments: { ...FOUNDRY_CREDS.deployments, embedding: "" },
    });
    const { callAIEmbedding } = await import("../azure-client");
    await expect(callAIEmbedding("x")).rejects.toThrow("ai_embedding_not_configured");
    expect(create).not.toHaveBeenCalled();
  });

  it("throws on a wrong-dimension embedding", async () => {
    create.mockResolvedValue({ data: [{ embedding: Array(512).fill(0) }] });
    const { callAIEmbedding } = await import("../azure-client");
    await expect(callAIEmbedding("x")).rejects.toThrow("embedding_dim_mismatch");
  });

  it("flips the firm's connection when THIS call is the one Azure rejects", async () => {
    // The auth-failure reporting is one shared wrapper, so the risk it carries
    // is a call site that never got wrapped. Forge search is a call site an
    // advisor hits far more often than a document extraction, and it would go
    // on failing silently.
    mockResolve.mockResolvedValue({
      source: "firm",
      endpoint: "https://acme-ria.openai.azure.com",
      apiKey: "firm-key",
      apiVersion: "2030-01-01",
      deployments: { chat: "firm-chat", mini: "firm-mini", embedding: "firm-embed" },
    });
    const original = Object.assign(new Error("azure said 401"), { status: 401 });
    create.mockRejectedValue(original);
    const { callAIEmbedding } = await import("../azure-client");

    await expect(callAIEmbedding("irmaa brackets")).rejects.toBe(original);

    expect(mockSetStatus).toHaveBeenCalledWith(
      "org_acme",
      "azure_openai",
      "error",
      "Azure rejected the API key.",
    );
  });
});
