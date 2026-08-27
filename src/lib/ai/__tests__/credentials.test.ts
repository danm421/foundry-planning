import { describe, it, expect } from "vitest";
import {
  azureEndpointSchema,
  encodeAzureSecret,
  decodeAzureSecret,
  encodeAzureConfig,
  decodeAzureConfig,
} from "../credentials";

const VALID_CONFIG = {
  endpoint: "https://acme-ria.openai.azure.com",
  apiVersion: "2024-12-01-preview",
  chatDeployment: "gpt-5.4",
  miniDeployment: "gpt-5.4-mini",
  embeddingDeployment: "text-embedding-3-small",
};

describe("azureEndpointSchema", () => {
  it("accepts an https Azure OpenAI endpoint", () => {
    expect(azureEndpointSchema.safeParse("https://acme-ria.openai.azure.com").success).toBe(true);
  });

  it("accepts a trailing slash", () => {
    expect(azureEndpointSchema.safeParse("https://acme-ria.openai.azure.com/").success).toBe(true);
  });

  it("rejects http (downgrade)", () => {
    expect(azureEndpointSchema.safeParse("http://acme-ria.openai.azure.com").success).toBe(false);
  });

  it("rejects a non-Azure host", () => {
    expect(azureEndpointSchema.safeParse("https://evil.example.com").success).toBe(false);
  });

  it("rejects a lookalike suffix", () => {
    expect(azureEndpointSchema.safeParse("https://acme.openai.azure.com.evil.com").success).toBe(false);
  });

  it("rejects link-local metadata (SSRF)", () => {
    expect(azureEndpointSchema.safeParse("https://169.254.169.254").success).toBe(false);
  });

  it("rejects the bare suffix with no instance", () => {
    expect(azureEndpointSchema.safeParse("https://openai.azure.com").success).toBe(false);
  });

  it("rejects a non-url", () => {
    expect(azureEndpointSchema.safeParse("not-a-url").success).toBe(false);
  });
});

describe("secret round trip", () => {
  it("encodes and decodes an api key", () => {
    expect(decodeAzureSecret(encodeAzureSecret({ apiKey: "sk-test" }))).toEqual({ apiKey: "sk-test" });
  });

  it("rejects an empty api key", () => {
    expect(() => encodeAzureSecret({ apiKey: "" })).toThrow();
  });
});

describe("config round trip", () => {
  it("encodes and decodes the full config", () => {
    expect(decodeAzureConfig(encodeAzureConfig(VALID_CONFIG))).toEqual(VALID_CONFIG);
  });

  it("rejects a config whose endpoint fails the host guard", () => {
    expect(() => encodeAzureConfig({ ...VALID_CONFIG, endpoint: "https://evil.example.com" })).toThrow();
  });

  it("rejects a missing deployment name", () => {
    expect(() => encodeAzureConfig({ ...VALID_CONFIG, embeddingDeployment: "" })).toThrow();
  });

  it("throws a named error on a null blob rather than returning a partial", () => {
    expect(() => decodeAzureConfig(null)).toThrow("azure config missing");
  });
});
