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

// `resolveAiCredentials` is azure-client.ts's own import; `clearAiCredentialCache`
// is what the real connection-status module calls (see the note below).
// `foundrySystemCredentials` is SYNCHRONOUS, so stubbing it with the same async
// fake would hand a Promise to a synchronous caller — it is not stubbed at all.
const mockResolve = vi.fn();
const mockClearCache = vi.fn();
vi.mock("@/lib/ai/resolve", () => ({
  resolveAiCredentials: () => mockResolve(),
  clearAiCredentialCache: (...a: unknown[]) => mockClearCache(...a),
}));

// `@/lib/ai/connection-status` is deliberately NOT mocked: the LEAVES it
// reaches are, so the real `isAzureAuthFailure` and `markAiConnectionError` run
// and the flip tests below prove the actual wiring rather than a stub of it.
// Mocking the module instead would mean re-implementing the 401/403
// discrimination here, which is the thing under test.
//
// Both leaf mocks are required, not decorative: the real
// `@/lib/integrations/connections` reaches `@/db`, and azure-client.ts now
// imports `auth` from Clerk to name the firm whose connection to flip.
const mockSetStatus = vi.fn();
vi.mock("@/lib/integrations/connections", () => ({
  setConnectionStatus: (...a: unknown[]) => mockSetStatus(...a),
}));
const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

import { callAIExtraction, callAIExtractionWithMeta } from "../azure-client";
import { azureClientOptions } from "@/lib/ai/client";

/** What the resolver returns for a firm that has NOT connected its own Azure
 *  resource: Foundry Planning's own tenant. */
const FOUNDRY_CREDS = {
  source: "foundry",
  endpoint: "https://test.openai.azure.com",
  apiKey: "test-key",
  apiVersion: "2024-12-01-preview",
  deployments: { chat: "gpt-5.4", mini: "foundry-mini", embedding: "text-embedding-3-small" },
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
    expect(createCall.model).toBe("foundry-mini");
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
    expect(mockCreate.mock.calls[0][0].model).toBe("foundry-mini");

    await callAIExtraction("sys", "user", "mini");
    expect(mockCreate.mock.calls[1][0].model).toBe("firm-mini");
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });
});

/**
 * The load-bearing behaviour of this path: a firm whose Azure rejects the key
 * gets their connection flipped to `error`, so the Integrations card says why
 * AI stopped instead of the advisor seeing an opaque failure forever.
 *
 * These run the REAL connection-status module (only the DB write and Clerk are
 * stubbed), so the 401/403 discrimination, the firm-vs-Foundry gate, the firm
 * id and the detail string are all genuinely under test.
 */
describe("a rejected key flips the firm's connection", () => {
  /** An Azure SDK error carries the HTTP status on `.status`. */
  function azureError(status: number): Error & { status: number } {
    return Object.assign(new Error(`azure said ${status}`), { status });
  }

  beforeEach(() => {
    mockCreate.mockReset();
    mockResolve.mockReset();
    mockSetStatus.mockReset();
    mockClearCache.mockReset();
    mockAuth.mockReset().mockResolvedValue({ orgId: "org_acme" });
  });

  it("flips the FIRM's connection on a 401, and rethrows the original untouched", async () => {
    mockResolve.mockResolvedValue(FIRM_CREDS);
    const original = azureError(401);
    mockCreate.mockRejectedValue(original);

    // `toBe`, not `toThrow`: identity is the assertion. Swallowing the Azure
    // error and throwing our own would leave the caller — and the advisor —
    // with a message about bookkeeping instead of about the failure.
    await expect(callAIExtractionWithMeta("sys", "user", "mini")).rejects.toBe(original);

    expect(mockSetStatus).toHaveBeenCalledWith(
      "org_acme",
      "azure_openai",
      "error",
      "Azure rejected the API key.",
    );
    expect(mockClearCache).toHaveBeenCalledWith("org_acme");
  });

  it("flips on a 403 too", async () => {
    mockResolve.mockResolvedValue(FIRM_CREDS);
    mockCreate.mockRejectedValue(azureError(403));

    await expect(callAIExtractionWithMeta("sys", "user", "mini")).rejects.toThrow("azure said 403");
    // Args, not just a count: "was called" would pass on the wrong firm, the
    // wrong provider, or a status of "connected".
    expect(mockSetStatus).toHaveBeenCalledWith(
      "org_acme",
      "azure_openai",
      "error",
      "Azure rejected the API key.",
    );
  });

  it("does NOT flip when FOUNDRY's key is the one rejected", async () => {
    // A rejection against Foundry Planning's own key is our outage, not the
    // firm's. Flagging their connection would send them to re-check
    // credentials that are fine — and, worse, park their AI on a badge they
    // cannot clear.
    mockResolve.mockResolvedValue(FOUNDRY_CREDS);
    const original = azureError(401);
    mockCreate.mockRejectedValue(original);

    await expect(callAIExtractionWithMeta("sys", "user", "mini")).rejects.toBe(original);

    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockClearCache).not.toHaveBeenCalled();
  });

  it("does NOT flip a firm on a 429 — a quota problem is not a wrong key", async () => {
    mockResolve.mockResolvedValue(FIRM_CREDS);
    const original = azureError(429);
    mockCreate.mockRejectedValue(original);

    await expect(callAIExtractionWithMeta("sys", "user", "mini")).rejects.toBe(original);

    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("does NOT flip a firm on a 500 or a timeout", async () => {
    mockResolve.mockResolvedValue(FIRM_CREDS);
    mockCreate.mockRejectedValueOnce(azureError(500));
    await expect(callAIExtractionWithMeta("sys", "user", "mini")).rejects.toThrow("azure said 500");

    mockCreate.mockRejectedValueOnce(new Error("timed out"));
    await expect(callAIExtractionWithMeta("sys", "user", "mini")).rejects.toThrow("timed out");

    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("still rethrows the original when the bookkeeping itself blows up", async () => {
    // auth() THROWS outside a request context, and the DB can be down. Neither
    // may replace the error the caller is handling.
    mockResolve.mockResolvedValue(FIRM_CREDS);
    mockAuth.mockRejectedValue(new Error("auth() outside a request"));
    const original = azureError(401);
    mockCreate.mockRejectedValue(original);

    await expect(callAIExtractionWithMeta("sys", "user", "mini")).rejects.toBe(original);
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("does not attempt a flip when there is no org to flip", async () => {
    mockResolve.mockResolvedValue(FIRM_CREDS);
    mockAuth.mockResolvedValue({ orgId: null });
    const original = azureError(401);
    mockCreate.mockRejectedValue(original);

    await expect(callAIExtractionWithMeta("sys", "user", "mini")).rejects.toBe(original);
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("leaves a successful call completely alone", async () => {
    // The wrapper sits on the hot path of every extraction; a stray write on
    // the success path would flip a healthy firm to `error`.
    mockResolve.mockResolvedValue(FIRM_CREDS);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
    });

    await callAIExtractionWithMeta("sys", "user", "mini");

    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockAuth).not.toHaveBeenCalled();
  });
});
