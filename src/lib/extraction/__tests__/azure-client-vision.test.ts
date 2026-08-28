import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: "PAGE 1 TEXT" }, finish_reason: "stop" }],
});

vi.mock("openai", () => {
  class MockAzureOpenAI {
    chat = { completions: { create: mockCreate } };
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

import { callAIVisionTranscription } from "../azure-client";

const FOUNDRY_CREDS = {
  source: "foundry",
  endpoint: "https://test.openai.azure.com",
  apiKey: "test-key",
  apiVersion: "2024-12-01-preview",
  deployments: { chat: "gpt-5.4", mini: "gpt-5.4-mini", embedding: "text-embedding-3-small" },
};

describe("callAIVisionTranscription", () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "PAGE 1 TEXT" }, finish_reason: "stop" }],
    });
    mockResolve.mockReset().mockResolvedValue(FOUNDRY_CREDS);
    mockSetStatus.mockReset();
    mockClearCache.mockReset();
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

  it("transcribes page images in the FIRM's tenant, not Foundry Planning's", async () => {
    // Page images are sent un-redacted (pixels cannot be SSN-redacted), so this
    // is the most sensitive payload the extraction path sends anywhere.
    mockResolve.mockResolvedValue({
      source: "firm",
      endpoint: "https://acme-ria.openai.azure.com",
      apiKey: "firm-key",
      apiVersion: "2030-01-01",
      deployments: { chat: "firm-chat", mini: "firm-mini", embedding: "firm-embed" },
    });
    await callAIVisionTranscription([{ b64: "QUJD", mime: "image/jpeg" }], "full");
    expect(mockCreate.mock.calls[0][0].model).toBe("firm-chat");
  });

  it("throws when the model returns empty content", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" }, finish_reason: "stop" }] });
    await expect(
      callAIVisionTranscription([{ b64: "QUJD", mime: "image/jpeg" }], "mini"),
    ).rejects.toThrow(/empty/i);
  });

  it("flips the firm's connection when THIS call is the one Azure rejects", async () => {
    // The auth-failure reporting is one shared wrapper, so the risk it carries
    // is a call site that never got wrapped. This one is reached only by
    // scanned PDFs, which is exactly the kind of path a copy-paste job misses.
    mockResolve.mockResolvedValue({
      source: "firm",
      endpoint: "https://acme-ria.openai.azure.com",
      apiKey: "firm-key",
      apiVersion: "2030-01-01",
      deployments: { chat: "firm-chat", mini: "firm-mini", embedding: "firm-embed" },
    });
    const original = Object.assign(new Error("azure said 401"), { status: 401 });
    mockCreate.mockRejectedValueOnce(original);

    await expect(
      callAIVisionTranscription([{ b64: "QUJD", mime: "image/jpeg" }], "mini"),
    ).rejects.toBe(original);

    expect(mockSetStatus).toHaveBeenCalledWith(
      "org_acme",
      "azure_openai",
      "error",
      "Azure rejected the API key.",
    );
  });
});
