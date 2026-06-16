import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();

vi.mock("openai", () => {
  class MockAzureOpenAI {
    embeddings = { create };
    constructor(_opts: unknown) {}
  }
  return { AzureOpenAI: MockAzureOpenAI };
});

describe("callAIEmbedding", () => {
  beforeEach(() => {
    vi.resetModules();
    create.mockReset();
    process.env.AZURE_ENDPOINT = "https://x.openai.azure.com";
    process.env.AZURE_API_KEY = "k";
    process.env.AZURE_API_VERSION = "2024-10-01";
    process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT = "text-embedding-3-small";
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

  it("fails closed when AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT is missing", async () => {
    delete process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT;
    const { callAIEmbedding } = await import("../azure-client");
    await expect(callAIEmbedding("x")).rejects.toThrow("ai_embedding_not_configured");
  });

  it("throws on a wrong-dimension embedding", async () => {
    create.mockResolvedValue({ data: [{ embedding: Array(512).fill(0) }] });
    const { callAIEmbedding } = await import("../azure-client");
    await expect(callAIEmbedding("x")).rejects.toThrow("embedding_dim_mismatch");
  });
});
