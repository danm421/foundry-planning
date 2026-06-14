import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: '{"accounts": []}' }, finish_reason: "stop" }],
});

vi.mock("openai", () => {
  class MockAzureOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(_opts: unknown) {}
  }
  return {
    AzureOpenAI: MockAzureOpenAI,
  };
});

import { azureClientOptions, callAIExtraction, callAIExtractionWithMeta } from "../azure-client";

describe("azureClientOptions", () => {
  it("bounds the request timeout inside the function budget and caps retries", () => {
    const opts = azureClientOptions("test-key");
    expect(opts.apiKey).toBe("test-key");
    expect(opts.timeout).toBeLessThanOrEqual(55_000);
    expect(opts.timeout).toBeGreaterThan(0);
    expect(opts.maxRetries).toBeLessThanOrEqual(1);
  });
});

describe("callAIExtraction", () => {
  beforeEach(() => {
    vi.stubEnv("AZURE_API_KEY", "test-key");
    vi.stubEnv("AZURE_ENDPOINT", "https://test.openai.azure.com/");
    vi.stubEnv("AZURE_API_VERSION", "2024-12-01-preview");
    vi.stubEnv("AZURE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "gpt-5.4");
    mockCreate.mockClear();
  });

  it("calls Azure OpenAI with system and user prompts", async () => {
    const result = await callAIExtraction("system prompt", "user prompt", "mini");
    expect(result).toBe('{"accounts": []}');
  });

  it("uses mini model by default", async () => {
    await callAIExtraction("sys", "user", "mini");
    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.model).toBe("gpt-5.4-mini");
  });

  it("uses full model when specified", async () => {
    await callAIExtraction("sys", "user", "full");
    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.model).toBe("gpt-5.4");
  });

  it("throws when no API key is configured", async () => {
    vi.stubEnv("AZURE_API_KEY", "");
    await expect(callAIExtraction("sys", "user", "mini")).rejects.toThrow(
      "AZURE_API_KEY"
    );
  });
});

describe("callAIExtractionWithMeta", () => {
  beforeEach(() => {
    vi.stubEnv("AZURE_API_KEY", "test-key");
    vi.stubEnv("AZURE_ENDPOINT", "https://test.openai.azure.com/");
    vi.stubEnv("AZURE_API_VERSION", "2024-12-01-preview");
    vi.stubEnv("AZURE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "gpt-5.4");
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"holdings": []}' }, finish_reason: "stop" }],
    });
  });

  it("returns content and finishReason", async () => {
    const r = await callAIExtractionWithMeta("sys", "user", "mini");
    expect(r.content).toBe('{"holdings": []}');
    expect(r.finishReason).toBe("stop");
  });

  it("surfaces a length finishReason (truncation)", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"holdings": [' }, finish_reason: "length" }],
    });
    const r = await callAIExtractionWithMeta("sys", "user", "mini");
    expect(r.finishReason).toBe("length");
  });
});
