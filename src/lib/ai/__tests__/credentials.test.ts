import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
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

/**
 * Asserts the call threw a ZodError carrying an issue on `field`. Stronger than
 * a bare `toThrow()`: if a `.min(1)` is dropped the call stops throwing at all
 * and `err` stays undefined, and a TypeError from a refactor is not a ZodError.
 */
function expectZodIssueOn(fn: () => unknown, field: string) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  expect((err as ZodError).issues.map((i) => i.path.join("."))).toContain(field);
}

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

  it("normalizes a pasted portal Target URI down to the origin", () => {
    expect(
      azureEndpointSchema.parse("https://acme.openai.azure.com/openai/deployments/x?api-version=1"),
    ).toBe("https://acme.openai.azure.com");
  });

  it("strips userinfo so credentials cannot reach the plaintext config blob", () => {
    expect(azureEndpointSchema.parse("https://user:pass@acme.openai.azure.com/x")).toBe(
      "https://acme.openai.azure.com",
    );
  });
});

describe("secret round trip", () => {
  it("encodes and decodes an api key", () => {
    expect(decodeAzureSecret(encodeAzureSecret({ apiKey: "sk-test" }))).toEqual({ apiKey: "sk-test" });
  });

  it("rejects an empty api key", () => {
    expectZodIssueOn(() => encodeAzureSecret({ apiKey: "" }), "apiKey");
  });

  it("throws a fixed string on a non-json secret blob, never echoing key bytes", () => {
    const LEGACY_RAW_KEY = "sk-live-SUPERSECRET-9f3a2b";
    let message = "";
    try {
      decodeAzureSecret(LEGACY_RAW_KEY);
    } catch (e) {
      message = (e as Error).message;
    }
    // Node's JSON.parse SyntaxError would read: Unexpected token 's', "sk-live-SU"...
    expect(message).toBe("azure secret malformed");
    expect(message).not.toContain("sk-live");
    expect(message).not.toContain("SUPERSECRET");
  });
});

describe("config round trip", () => {
  it("encodes and decodes the full config", () => {
    expect(decodeAzureConfig(encodeAzureConfig(VALID_CONFIG))).toEqual(VALID_CONFIG);
  });

  it("persists the normalized origin in the config blob, not the pasted path", () => {
    const blob = encodeAzureConfig({
      ...VALID_CONFIG,
      endpoint: "https://acme-ria.openai.azure.com/openai/deployments/x?api-version=1",
    });
    expect(JSON.parse(blob).endpoint).toBe("https://acme-ria.openai.azure.com");
  });

  it("rejects a config whose endpoint fails the host guard", () => {
    expect(() => encodeAzureConfig({ ...VALID_CONFIG, endpoint: "https://evil.example.com" })).toThrow(
      "<instance>.openai.azure.com host",
    );
  });

  it.each(["apiVersion", "chatDeployment", "miniDeployment", "embeddingDeployment"] as const)(
    "rejects a blank %s",
    (field) => {
      expectZodIssueOn(() => encodeAzureConfig({ ...VALID_CONFIG, [field]: "" }), field);
    },
  );

  it("throws a named error on a null blob rather than returning a partial", () => {
    expect(() => decodeAzureConfig(null)).toThrow("azure config missing");
  });
});
