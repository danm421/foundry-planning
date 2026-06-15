// src/domain/copilot/__tests__/llm.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.unstubAllEnvs());

  function stubAzureEnv() {
    vi.stubEnv("AZURE_ENDPOINT", "https://test-resource.openai.azure.com");
    vi.stubEnv("AZURE_API_KEY", "test-key");
    vi.stubEnv("AZURE_API_VERSION", "2024-12-01-preview");
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "gpt-5.4");
    vi.stubEnv("AZURE_MODEL", "gpt-5.4-mini");
  }

  // gpt-5.4 / gpt-5.4-mini are GPT-5-series reasoning deployments that reject any
  // non-default `temperature` with a 400. @langchain/openai sends temperature
  // whenever it is set (and does NOT strip it for reasoning models), so the
  // factory must leave it unset — otherwise the first real streamEvents turn 400s
  // and the stream route emits an error with zero tokens. This contract test is
  // the only guard, since the route/graph tests mock the model entirely.
  it.each(["full", "mini"] as const)(
    "does not pin a forbidden temperature on the %s reasoning deployment",
    (variant) => {
      stubAzureEnv();
      const model = chatModel(variant);
      expect(model.temperature).toBeUndefined();
      // streaming must stay on so streamEvents v2 surfaces on_chat_model_stream deltas.
      expect(model.streaming).toBe(true);
    },
  );

  it("throws ai_not_configured when required Azure env is missing", () => {
    vi.stubEnv("AZURE_ENDPOINT", "");
    vi.stubEnv("AZURE_API_KEY", "");
    vi.stubEnv("AZURE_API_VERSION", "");
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "");
    vi.stubEnv("AZURE_MODEL", "");
    expect(() => chatModel("full")).toThrow("ai_not_configured");
  });
});
