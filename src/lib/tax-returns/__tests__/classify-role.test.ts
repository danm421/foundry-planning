import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: vi.fn() }));

import { callAIExtraction } from "@/lib/extraction/azure-client";
import { classifyDocumentRole } from "../classify-role";
import { TaxReturnExtractionError } from "../errors";

beforeEach(() => vi.clearAllMocks());

describe("classifyDocumentRole", () => {
  it("returns the classified role", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue('{"role":"k1"}');
    await expect(classifyDocumentRole(["Schedule K-1 (Form 1065)"])).resolves.toBe("k1");
  });

  it("always classifies on the mini model, whatever the document", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue('{"role":"full_return"}');
    await classifyDocumentRole(["Form 1040"]);
    expect(vi.mocked(callAIExtraction).mock.calls[0][2]).toBe("mini");
  });

  it("sends only a bounded prefix, so a 200-page packet cannot blow the call", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue('{"role":"full_return"}');
    await classifyDocumentRole([("x").repeat(50_000), ("y").repeat(50_000)]);
    expect(vi.mocked(callAIExtraction).mock.calls[0][1].length).toBeLessThanOrEqual(6_000);
  });

  it("throws rather than guessing a role when the model returns something unusable", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue("I think this is a K-1?");
    await expect(classifyDocumentRole(["something"])).rejects.toBeInstanceOf(
      TaxReturnExtractionError,
    );
  });

  it("throws rather than guessing when the role is not one of the four", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue('{"role":"1099"}');
    await expect(classifyDocumentRole(["something"])).rejects.toBeInstanceOf(
      TaxReturnExtractionError,
    );
  });

  it("throws rather than guessing when the AI call itself fails", async () => {
    vi.mocked(callAIExtraction).mockRejectedValue(new Error("azure 500"));
    await expect(classifyDocumentRole(["something"])).rejects.toBeInstanceOf(
      TaxReturnExtractionError,
    );
  });
});
