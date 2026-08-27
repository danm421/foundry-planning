import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChatCreate = vi.fn();
const mockEmbeddingsCreate = vi.fn();
/** Records the options every AzureOpenAI client is built with, so a test can
 *  prove WHICH tenant each check ran in — the whole point of the feature. */
const mockCtor = vi.fn();

vi.mock("openai", () => {
  class MockAzureOpenAI {
    chat = { completions: { create: mockChatCreate } };
    embeddings = { create: mockEmbeddingsCreate };
    constructor(opts: unknown) {
      mockCtor(opts);
    }
  }
  return { AzureOpenAI: MockAzureOpenAI };
});

const mockFoundryCreds = vi.fn();
vi.mock("../resolve", () => ({ foundrySystemCredentials: () => mockFoundryCreds() }));

import {
  verifyAzureConnection,
  cosineSimilarity,
  MIN_EMBEDDING_COSINE,
} from "../verify-connection";
import type { AiCredentials } from "../credentials";

const FIRM: AiCredentials = {
  source: "firm",
  endpoint: "https://acme-ria.openai.azure.com",
  apiKey: "firm-key",
  apiVersion: "2030-01-01",
  deployments: { chat: "firm-chat", mini: "firm-mini", embedding: "firm-embed" },
};

function vec(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(seed + i));
}

/**
 * Seeds for the "different model" fixture.
 *
 * `vec(a)` and `vec(b)` land at roughly `cos(a - b)`, so the seeds are not
 * interchangeable. The plan's original pair (1 vs 900) differs by only ~0.50
 * radians once wrapped and measures ~0.875 — below the 0.99 threshold, but only
 * just. A guard whose margin depends on the very constant it guards would start
 * passing for the wrong reason the moment that constant moved, so these seeds
 * differ by ~3π/2 and land near-orthogonal (~0.005), which is also what two
 * genuinely unrelated embedding models actually look like.
 */
const SAME_SEED = 1;
const DIFFERENT_SEED = 12;

/** Measured at module load so the number is visible in the test title rather
 *  than assumed. Printed by `--reporter=verbose`. */
const DIFFERENT_COSINE = cosineSimilarity(vec(SAME_SEED), vec(DIFFERENT_SEED));

/** A different *instance* of the same model: not bit-identical, but the same
 *  semantic space. Measures ~0.9997. */
const NEAR_SEED = 1000;

function goodChatReply() {
  return {
    choices: [
      {
        message: {
          content: '{"ok":true}',
          tool_calls: [{ id: "1", function: { name: "ping", arguments: "{}" } }],
        },
      },
    ],
  };
}

function embeddingReply(seed: number) {
  return { data: [{ embedding: vec(seed) }] };
}

beforeEach(() => {
  // Block bodies, deliberately. `beforeEach(() => x.mockReset())` returns the
  // mock, which vitest then treats as the test's teardown function and calls —
  // a phantom invocation that pollutes the very call counts these tests read.
  mockChatCreate.mockReset();
  mockEmbeddingsCreate.mockReset();
  mockCtor.mockReset();
  mockFoundryCreds.mockReset();
  mockFoundryCreds.mockReturnValue({
    source: "foundry",
    endpoint: "https://foundry.openai.azure.com",
    apiKey: "foundry-key",
    apiVersion: "2024-12-01-preview",
    deployments: { chat: "gpt-5.4", mini: "gpt-5.4-mini", embedding: "text-embedding-3-small" },
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity(vec(1), vec(1))).toBeCloseTo(1, 6);
  });

  it(`separates unrelated vectors by a wide margin (measured ${DIFFERENT_COSINE.toFixed(6)})`, () => {
    // Below 0.5, not merely below the threshold — see the seed comment above.
    expect(DIFFERENT_COSINE).toBeLessThan(0.5);
    expect(DIFFERENT_COSINE).toBeLessThan(MIN_EMBEDDING_COSINE);
  });

  it("returns 0, never NaN, for degenerate input", () => {
    // NaN would be catastrophic: `NaN < MIN_EMBEDDING_COSINE` is FALSE, so a
    // degenerate reference vector would silently PASS the compatibility check.
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("verifyAzureConnection", () => {
  it("passes when all three checks succeed", async () => {
    mockChatCreate.mockResolvedValue(goodChatReply());
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));

    const result = await verifyAzureConnection(FIRM);

    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.name)).toEqual(["chat", "mini", "embedding"]);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it("runs each check against the deployment it names, in the tenant that owns it", async () => {
    mockChatCreate.mockResolvedValue(goodChatReply());
    mockEmbeddingsCreate
      .mockResolvedValueOnce(embeddingReply(SAME_SEED))
      .mockResolvedValueOnce(embeddingReply(SAME_SEED));

    await verifyAzureConnection(FIRM);

    // The mini check must exercise the MINI deployment. Passing the chat
    // deployment twice would leave the firm's mini model unverified and every
    // assertion above still green.
    expect(mockChatCreate.mock.calls[0][0].model).toBe("firm-chat");
    expect(mockChatCreate.mock.calls[1][0].model).toBe("firm-mini");
    expect(mockEmbeddingsCreate.mock.calls[0][0].model).toBe("firm-embed");
    // The reference vector — and ONLY the reference vector — comes from
    // Foundry Planning's tenant.
    expect(mockEmbeddingsCreate.mock.calls[1][0].model).toBe("text-embedding-3-small");

    const keys = mockCtor.mock.calls.map((c) => c[0].apiKey);
    expect(keys).toEqual(["firm-key", "firm-key", "firm-key", "foundry-key"]);
    const endpoints = mockCtor.mock.calls.map((c) => c[0].endpoint);
    expect(endpoints.slice(0, 3)).toEqual([
      "https://acme-ria.openai.azure.com",
      "https://acme-ria.openai.azure.com",
      "https://acme-ria.openai.azure.com",
    ]);
    expect(endpoints[3]).toBe("https://foundry.openai.azure.com");
  });

  it("requires a tool call, not just an answer", async () => {
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: "hi there" } }] });
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));

    const result = await verifyAzureConnection(FIRM);

    expect(result.ok).toBe(false);
    const chat = result.checks.find((c) => c.name === "chat")!;
    expect(chat.ok).toBe(false);
    expect(chat.detail).toMatch(/tool/i);
    // The mini deployment is held to the same bar.
    const mini = result.checks.find((c) => c.name === "mini")!;
    expect(mini.ok).toBe(false);
    expect(mini.detail).toMatch(/tool/i);
  });

  it("fails a chat check when the reply carries an EMPTY tool_calls array", async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: "hi there", tool_calls: [] } }],
    });
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));

    const result = await verifyAzureConnection(FIRM);
    expect(result.checks.find((c) => c.name === "chat")!.ok).toBe(false);
  });

  it("fails the chat check when the deployment does not exist", async () => {
    mockChatCreate.mockRejectedValue(new Error("DeploymentNotFound"));
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));

    const result = await verifyAzureConnection(FIRM);
    expect(result.checks.find((c) => c.name === "chat")!.ok).toBe(false);
  });

  // ---- The check that prevents silent damage ----

  it("REFUSES a different embedding model even though the dimensions are right", async () => {
    mockChatCreate.mockResolvedValue(goodChatReply());
    // The firm's tenant answers first with one vector, Foundry Planning's
    // reference with another.
    mockEmbeddingsCreate
      .mockResolvedValueOnce(embeddingReply(SAME_SEED))
      .mockResolvedValueOnce(embeddingReply(DIFFERENT_SEED));

    const result = await verifyAzureConnection(FIRM);

    expect(result.ok).toBe(false);
    const emb = result.checks.find((c) => c.name === "embedding")!;
    expect(emb.ok).toBe(false);
    expect(emb.detail).toMatch(/different model/i);
  });

  it("accepts the same model in two tenants, which is close but not identical", async () => {
    mockChatCreate.mockResolvedValue(goodChatReply());
    mockEmbeddingsCreate
      .mockResolvedValueOnce(embeddingReply(SAME_SEED))
      .mockResolvedValueOnce(embeddingReply(NEAR_SEED));

    const result = await verifyAzureConnection(FIRM);

    // Pins the threshold from ABOVE: a constant tightened toward 1 would start
    // rejecting genuinely compatible deployments over floating-point drift.
    expect(cosineSimilarity(vec(SAME_SEED), vec(NEAR_SEED))).toBeGreaterThan(MIN_EMBEDDING_COSINE);
    expect(result.checks.find((c) => c.name === "embedding")!.ok).toBe(true);
  });

  it("fails the embedding check on the wrong dimension", async () => {
    mockChatCreate.mockResolvedValue(goodChatReply());
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: Array(3072).fill(0.1) }] });

    const result = await verifyAzureConnection(FIRM);
    const emb = result.checks.find((c) => c.name === "embedding")!;
    expect(emb.ok).toBe(false);
    expect(emb.detail).toMatch(/1536/);
    // A wrong-dimension deployment is rejected on its own evidence; there is no
    // reason to spend a reference call in Foundry Planning's tenant.
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
  });

  it("fails the embedding check when the firm named no embedding deployment", async () => {
    mockChatCreate.mockResolvedValue(goodChatReply());

    const result = await verifyAzureConnection({
      ...FIRM,
      deployments: { ...FIRM.deployments, embedding: "" },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "embedding")!.ok).toBe(false);
    expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
  });

  it("FAILS the connection when Foundry Planning's own embedding deployment is unset", async () => {
    // Deliberate, and not a warning: without a reference vector we cannot tell a
    // compatible model from an incompatible one, and "cannot verify, so allow"
    // is the exact silent-failure hole this check exists to close.
    mockChatCreate.mockResolvedValue(goodChatReply());
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));
    mockFoundryCreds.mockReturnValue({
      source: "foundry",
      endpoint: "https://foundry.openai.azure.com",
      apiKey: "foundry-key",
      apiVersion: "2024-12-01-preview",
      deployments: { chat: "gpt-5.4", mini: "gpt-5.4-mini", embedding: "" },
    });

    const result = await verifyAzureConnection(FIRM);

    expect(result.ok).toBe(false);
    const emb = result.checks.find((c) => c.name === "embedding")!;
    expect(emb.ok).toBe(false);
    expect(emb.detail).toMatch(/cannot be verified/i);
  });

  it("FAILS the connection when Foundry Planning's own resource is not configured at all", async () => {
    mockChatCreate.mockResolvedValue(goodChatReply());
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));
    mockFoundryCreds.mockImplementation(() => {
      throw new Error("ai_not_configured");
    });

    const result = await verifyAzureConnection(FIRM);

    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "embedding")!.ok).toBe(false);
  });

  it("reports every check even when an earlier one failed", async () => {
    mockChatCreate.mockRejectedValue(new Error("nope"));
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));

    const result = await verifyAzureConnection(FIRM);
    expect(result.checks).toHaveLength(3);
  });

  it("never leaks the api key into a check detail", async () => {
    mockChatCreate.mockRejectedValue(new Error("bad key firm-key rejected"));
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));

    const result = await verifyAzureConnection(FIRM);
    expect(JSON.stringify(result)).not.toContain("firm-key");
  });

  it("never leaks FOUNDRY PLANNING's own key when the reference call fails", async () => {
    // The reference call runs in OUR tenant with OUR key, and its error text is
    // rendered in a firm admin's browser. Redacting only the firm's key here
    // would hand our own credential to every admin who clicks Test connection.
    mockChatCreate.mockResolvedValue(goodChatReply());
    mockEmbeddingsCreate
      .mockResolvedValueOnce(embeddingReply(SAME_SEED))
      .mockRejectedValueOnce(new Error("401 from https://foundry... api-key=foundry-key"));

    const result = await verifyAzureConnection(FIRM);

    expect(result.checks.find((c) => c.name === "embedding")!.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("foundry-key");
  });

  it("never writes a bare 'Foundry' into an admin-facing detail", async () => {
    // Microsoft's portal is "Microsoft Foundry"; our product is "Foundry
    // Planning". A bare "Foundry" in front of an Azure admin is ambiguous
    // between the two.
    const details: string[] = [];

    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }] });
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: Array(3072).fill(0.1) }] });
    details.push(...(await verifyAzureConnection(FIRM)).checks.map((c) => c.detail ?? ""));

    mockChatCreate.mockResolvedValue(goodChatReply());
    mockEmbeddingsCreate.mockReset();
    mockEmbeddingsCreate
      .mockResolvedValueOnce(embeddingReply(SAME_SEED))
      .mockResolvedValueOnce(embeddingReply(DIFFERENT_SEED));
    details.push(...(await verifyAzureConnection(FIRM)).checks.map((c) => c.detail ?? ""));

    mockEmbeddingsCreate.mockReset();
    mockEmbeddingsCreate.mockResolvedValue(embeddingReply(SAME_SEED));
    mockFoundryCreds.mockReturnValue({
      source: "foundry",
      endpoint: "https://foundry.openai.azure.com",
      apiKey: "foundry-key",
      apiVersion: "2024-12-01-preview",
      deployments: { chat: "gpt-5.4", mini: "gpt-5.4-mini", embedding: "" },
    });
    details.push(...(await verifyAzureConnection(FIRM)).checks.map((c) => c.detail ?? ""));

    const withFoundry = details.filter((d) => d.includes("Foundry"));
    // Guard the guard: if no detail mentions us at all, this test proves nothing.
    expect(withFoundry.length).toBeGreaterThan(0);
    for (const detail of withFoundry) {
      for (let i = detail.indexOf("Foundry"); i !== -1; i = detail.indexOf("Foundry", i + 1)) {
        const qualified =
          detail.startsWith("Foundry Planning", i) || detail.slice(0, i).endsWith("Microsoft ");
        expect(qualified, `bare "Foundry" at ${i} in: ${detail}`).toBe(true);
      }
    }
  });
});
