// src/domain/copilot/__tests__/llm.test.ts
import { describe, expect, it } from "vitest";
import { instanceNameFromEndpoint } from "../llm";

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
