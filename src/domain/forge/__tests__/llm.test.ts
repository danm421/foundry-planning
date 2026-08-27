// src/domain/forge/__tests__/llm.test.ts
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

// Only `resolveAiCredentials` is stubbed — it is the sole import llm.ts makes
// from that module. The factory is hoisted above `mockResolve`'s declaration,
// but it only CLOSES OVER the binding: `mockResolve()` is dereferenced when a
// test calls the resolver, long after the const has initialised.
const mockResolve = vi.fn();
vi.mock("@/lib/ai/resolve", () => ({ resolveAiCredentials: () => mockResolve() }));

import { chatModel, instanceNameFromEndpoint } from "../llm";

describe("instanceNameFromEndpoint", () => {
  it("extracts the instance subdomain from a full Azure endpoint URL", () => {
    expect(instanceNameFromEndpoint("https://ethoshub-resource.openai.azure.com")).toBe(
      "ethoshub-resource",
    );
  });

  it("tolerates a trailing slash / path", () => {
    expect(instanceNameFromEndpoint("https://ethoshub-resource.openai.azure.com/")).toBe(
      "ethoshub-resource",
    );
  });

  it("throws a typed error on a non-Azure / malformed endpoint", () => {
    expect(() => instanceNameFromEndpoint("not-a-url")).toThrow("ai_not_configured");
    expect(() => instanceNameFromEndpoint("https://example.com")).toThrow("ai_not_configured");
  });
});

describe("chatModel", () => {
  // BLOCK BODY, deliberately. `beforeEach(() => mockResolve.mockReset())` would
  // implicitly RETURN the mock, and vitest treats a function returned from
  // beforeEach as a per-test teardown — so it would CALL mockResolve after every
  // test, inventing a phantom call and, once a test has installed a rejecting
  // implementation, an unhandled rejection that fails the test. Measured, not
  // guessed.
  beforeEach(() => {
    mockResolve.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  /** A firm running in its OWN Azure tenant. Every value differs from the
   *  Foundry Planning env stubbed below, so a leak in either direction shows up
   *  as a concrete wrong value rather than as an absence. */
  function firmCreds() {
    return {
      source: "firm" as const,
      endpoint: "https://acme-ria.openai.azure.com",
      apiKey: "firm-key",
      apiVersion: "2030-01-01",
      deployments: { chat: "firm-chat", mini: "firm-mini", embedding: "firm-embed" },
    };
  }

  /** Foundry Planning's own env, POPULATED and entirely different from the
   *  firm's. Without this a factory that read AZURE_* and found nothing would
   *  satisfy the "not Foundry's" assertion by accident — the assertion has to
   *  prove the firm's values WON, not that env happened to be empty. */
  function stubFoundryEnv() {
    vi.stubEnv("AZURE_ENDPOINT", "https://foundry-planning.openai.azure.com");
    vi.stubEnv("AZURE_API_KEY", "foundry-key");
    vi.stubEnv("AZURE_API_VERSION", "2024-12-01-preview");
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "foundry-chat");
    vi.stubEnv("AZURE_MODEL", "foundry-mini");
  }

  // gpt-5.4 / gpt-5.4-mini are GPT-5-series reasoning deployments that reject any
  // non-default `temperature` with a 400. @langchain/openai sends temperature
  // whenever it is set (and does NOT strip it for reasoning models), so the
  // factory must leave it unset — otherwise the first real streamEvents turn 400s
  // and the stream route emits an error with zero tokens. This contract test is
  // the only guard, since the route/graph tests mock the model entirely.
  it.each(["full", "mini"] as const)(
    "does not pin a forbidden temperature on the %s reasoning deployment",
    async (variant) => {
      mockResolve.mockResolvedValue(firmCreds());
      const model = await chatModel(variant);
      expect(model.temperature).toBeUndefined();
      // streaming must stay on so streamEvents v2 surfaces on_chat_model_stream deltas.
      expect(model.streaming).toBe(true);
    },
  );

  it("binds the FIRM's instance and deployment, not Foundry's", async () => {
    stubFoundryEnv();
    mockResolve.mockResolvedValue(firmCreds());
    const model = await chatModel("full");
    expect(model.azureOpenAIApiInstanceName).toBe("acme-ria");
    expect(model.azureOpenAIApiDeploymentName).toBe("firm-chat");
    expect(model.azureOpenAIApiVersion).toBe("2030-01-01");
  });

  it("uses the mini deployment for the mini variant", async () => {
    stubFoundryEnv();
    mockResolve.mockResolvedValue(firmCreds());
    expect((await chatModel("mini")).azureOpenAIApiDeploymentName).toBe("firm-mini");
  });

  it("throws ai_not_configured when a required field is missing", async () => {
    mockResolve.mockResolvedValue({ ...firmCreds(), apiKey: "" });
    await expect(chatModel("full")).rejects.toThrow("ai_not_configured");
  });

  it("propagates the resolver's refusal rather than falling back", async () => {
    mockResolve.mockRejectedValue(new Error("ai_no_firm_context"));
    await expect(chatModel("full")).rejects.toThrow("ai_no_firm_context");
  });
});

describe("embeddings()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("delegates to callAIEmbedding", async () => {
    const callAIEmbedding = vi.fn().mockResolvedValue(Array(1536).fill(0.1));
    vi.doMock("@/lib/extraction/azure-client", () => ({ callAIEmbedding }));
    const { embeddings } = await import("../llm");
    const vec = await embeddings("retirement");
    expect(vec).toHaveLength(1536);
    expect(callAIEmbedding).toHaveBeenCalledWith("retirement");
  });
});
