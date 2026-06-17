import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: "PAGE 1 TEXT" }, finish_reason: "stop" }],
});

vi.mock("openai", () => {
  class MockAzureOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(_opts: unknown) {}
  }
  return { AzureOpenAI: MockAzureOpenAI };
});

import { callAIVisionTranscription } from "../azure-client";

describe("callAIVisionTranscription", () => {
  beforeEach(() => {
    vi.stubEnv("AZURE_API_KEY", "test-key");
    vi.stubEnv("AZURE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "gpt-5.4");
    mockCreate.mockClear();
  });

  it("sends image_url content parts and returns the transcription", async () => {
    const out = await callAIVisionTranscription(
      [{ b64: "QUJD", mime: "image/jpeg" }],
      "mini",
    );
    expect(out).toBe("PAGE 1 TEXT");

    const arg = mockCreate.mock.calls[0][0];
    expect(arg.model).toBe("gpt-5.4-mini");
    const content = arg.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,QUJD" },
    });
  });

  it("throws when the model returns empty content", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" }, finish_reason: "stop" }] });
    await expect(
      callAIVisionTranscription([{ b64: "QUJD", mime: "image/jpeg" }], "mini"),
    ).rejects.toThrow(/empty/i);
  });
});
