import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();

vi.mock("openai", () => {
  class MockAzureOpenAI {
    embeddings = { create };
    constructor() {}
  }
  return { AzureOpenAI: MockAzureOpenAI };
});

// Only `resolveAiCredentials` — the sole import azure-client.ts makes from that
// module, and the only one that is async.
const mockResolve = vi.fn();
vi.mock("@/lib/ai/resolve", () => ({ resolveAiCredentials: () => mockResolve() }));

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
});
