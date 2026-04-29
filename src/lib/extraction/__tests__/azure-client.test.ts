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

import { callAIExtraction } from "../azure-client";

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

  it("tags requests with x-ms-azureai-sensitivity: high header", async () => {
    await callAIExtraction("sys", "user", "mini");
    const requestOptions = mockCreate.mock.calls[0][1];
    expect(requestOptions?.headers?.["x-ms-azureai-sensitivity"]).toBe("high");
  });
});
