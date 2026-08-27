import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: '{"accounts": []}' }, finish_reason: "stop" }],
});

/** Every options object an AzureOpenAI client was built with, in order — the
 *  only way to see WHICH tenant a call's client actually points at. */
const constructedWith: Array<Record<string, unknown>> = [];

vi.mock("openai", () => {
  class MockAzureOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(opts: Record<string, unknown>) {
      constructedWith.push(opts);
    }
  }
  return {
    AzureOpenAI: MockAzureOpenAI,
  };
});

// Only `resolveAiCredentials` is stubbed — it is the sole import
// azure-client.ts makes from that module. `foundrySystemCredentials` is
// SYNCHRONOUS, so stubbing it with the same async fake would hand a Promise to
// a synchronous caller.
const mockResolve = vi.fn();
vi.mock("@/lib/ai/resolve", () => ({ resolveAiCredentials: () => mockResolve() }));

import { callAIExtraction, callAIExtractionWithMeta } from "../azure-client";
import { azureClientOptions } from "@/lib/ai/client";

/** What the resolver returns for a firm that has NOT connected its own Azure
 *  resource: Foundry Planning's own tenant. */
const FOUNDRY_CREDS = {
  source: "foundry",
  endpoint: "https://test.openai.azure.com",
  apiKey: "test-key",
  apiVersion: "2024-12-01-preview",
  deployments: { chat: "gpt-5.4", mini: "gpt-5.4-mini", embedding: "text-embedding-3-small" },
};

/** A firm running in its OWN tenant. Every value differs from FOUNDRY_CREDS so
 *  a leak in either direction is visible. */
const FIRM_CREDS = {
  source: "firm",
  endpoint: "https://acme-ria.openai.azure.com",
  apiKey: "firm-key",
  apiVersion: "2030-01-01",
  deployments: { chat: "firm-chat", mini: "firm-mini", embedding: "firm-embed" },
};

describe("azureClientOptions", () => {
  it("passes the resolved credentials through and pins the timeout and retry budget", () => {
    const opts = azureClientOptions({
      apiKey: "test-key",
      endpoint: "https://test.openai.azure.com",
      apiVersion: "2024-12-01-preview",
    });
    expect(opts.apiKey).toBe("test-key");
    expect(opts.endpoint).toBe("https://test.openai.azure.com");
    expect(opts.apiVersion).toBe("2024-12-01-preview");
    // Exact, not bounded: these two are the only cover these constants have, and
    // a bound accepts timeout:1 / maxRetries:0 as happily as the real values.
    // 55s keeps a call inside the 300s function budget (SDK default is 10min);
    // maxRetries:1 stops a hung call retrying past it (SDK default is 2).
    expect(opts.timeout).toBe(55_000);
    expect(opts.maxRetries).toBe(1);
  });
});

describe("callAIExtraction", () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"accounts": []}' }, finish_reason: "stop" }],
    });
    mockResolve.mockReset().mockResolvedValue(FOUNDRY_CREDS);
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

  it("throws the ai_not_configured SENTINEL when the resolved credentials carry no key", async () => {
    // Not prose: src/app/api/crm/households/[id]/meeting-prep/runs/route.ts and
    // src/lib/observations/draft.ts both branch on this exact string.
    mockResolve.mockResolvedValue({ ...FOUNDRY_CREDS, apiKey: "" });
    let err: unknown;
    await callAIExtraction("sys", "user", "mini").catch((e) => {
      err = e;
    });
    expect((err as Error).message).toBe("ai_not_configured");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("callAIExtractionWithMeta", () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"holdings": []}' }, finish_reason: "stop" }],
    });
    mockResolve.mockReset().mockResolvedValue(FOUNDRY_CREDS);
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

describe("per-firm credentials", () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"accounts": []}' }, finish_reason: "stop" }],
    });
    mockResolve.mockReset();
    // Foundry Planning's own env is present and populated, exactly as it is in
    // production. Every assertion below therefore proves the firm's values WIN
    // over ours — not merely that env happened to be unset.
    vi.stubEnv("AZURE_API_KEY", "foundry-key");
    vi.stubEnv("AZURE_ENDPOINT", "https://foundry.openai.azure.com");
    vi.stubEnv("AZURE_API_VERSION", "2024-12-01-preview");
    vi.stubEnv("AZURE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "gpt-5.4");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses the FIRM's deployment names, not Foundry's env", async () => {
    mockResolve.mockResolvedValue(FIRM_CREDS);

    await callAIExtraction("sys", "user", "full");
    expect(mockCreate.mock.calls[0][0].model).toBe("firm-chat");

    await callAIExtraction("sys", "user", "mini");
    expect(mockCreate.mock.calls[1][0].model).toBe("firm-mini");
  });

  it("propagates the resolver's refusal instead of falling back", async () => {
    mockResolve.mockRejectedValue(new Error("ai_no_firm_context"));
    await expect(callAIExtraction("sys", "user", "mini")).rejects.toThrow("ai_no_firm_context");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("still honours an explicit deployment name passed by the caller", async () => {
    mockResolve.mockResolvedValue(FIRM_CREDS);
    await callAIExtraction("sys", "user", "o4-explicit");
    expect(mockCreate.mock.calls[0][0].model).toBe("o4-explicit");
  });

  it("builds a client per tenant+key, and reuses it only for the SAME credentials", async () => {
    // A fresh endpoint, so nothing earlier in this file has warmed the cache.
    const acme = {
      ...FIRM_CREDS,
      endpoint: "https://cache-probe.openai.azure.com",
    };
    constructedWith.length = 0;
    mockResolve
      .mockResolvedValueOnce(acme)
      .mockResolvedValueOnce({ ...acme, apiKey: "firm-key-rotated" })
      .mockResolvedValueOnce(acme);

    await callAIExtraction("sys", "user", "mini");
    await callAIExtraction("sys", "user", "mini");
    await callAIExtraction("sys", "user", "mini");

    // Same endpoint, same api version, DIFFERENT key: dropping the key from the
    // cache key would hand call two the client still holding the old one. Call
    // three repeats call one exactly, and must reuse rather than rebuild.
    expect(constructedWith).toEqual([
      {
        apiKey: "firm-key",
        endpoint: "https://cache-probe.openai.azure.com",
        apiVersion: "2030-01-01",
        timeout: 55_000,
        maxRetries: 1,
      },
      {
        apiKey: "firm-key-rotated",
        endpoint: "https://cache-probe.openai.azure.com",
        apiVersion: "2030-01-01",
        timeout: 55_000,
        maxRetries: 1,
      },
    ]);
  });

  it("asks the resolver on EVERY call, so a firm that just connected is not served a cached client", async () => {
    // The client cache is keyed on endpoint|apiVersion|apiKey, never on "the
    // last client we built": resolving again is what lets firm B's call reach
    // firm B's tenant after firm A's call warmed the module.
    mockResolve.mockResolvedValueOnce(FOUNDRY_CREDS).mockResolvedValueOnce(FIRM_CREDS);

    await callAIExtraction("sys", "user", "mini");
    expect(mockCreate.mock.calls[0][0].model).toBe("gpt-5.4-mini");

    await callAIExtraction("sys", "user", "mini");
    expect(mockCreate.mock.calls[1][0].model).toBe("firm-mini");
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });
});
