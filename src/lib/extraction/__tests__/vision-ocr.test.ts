// src/lib/extraction/__tests__/vision-ocr.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { renderPageAsImage, getDocumentProxy, createIsomorphicCanvasFactory } =
  vi.hoisted(() => ({
    renderPageAsImage: vi.fn(),
    getDocumentProxy: vi.fn(),
    createIsomorphicCanvasFactory: vi.fn(),
  }));
vi.mock("unpdf", () => ({
  getDocumentProxy,
  renderPageAsImage,
  createIsomorphicCanvasFactory,
}));

// Sentinel returned by the mocked factory resolver so we can assert the exact
// CanvasFactory instance is threaded into getDocumentProxy.
const FAKE_CANVAS_FACTORY = { __fakeCanvasFactory: true };

// sharp(buffer).resize(...).jpeg(...).toBuffer() chain → returns a tiny buffer.
vi.mock("sharp", () => {
  const chain = {
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("img")),
  };
  return { default: vi.fn(() => chain) };
});

const { callAIVisionTranscription } = vi.hoisted(() => ({
  callAIVisionTranscription: vi.fn(),
}));
vi.mock("../azure-client", () => ({ callAIVisionTranscription }));

import { visionOcrPdf } from "../vision-ocr";

beforeEach(() => {
  vi.stubEnv("AZURE_API_KEY", "test-key");
  renderPageAsImage.mockReset().mockResolvedValue(new ArrayBuffer(4));
  getDocumentProxy.mockReset();
  createIsomorphicCanvasFactory.mockReset().mockResolvedValue(FAKE_CANVAS_FACTORY);
  callAIVisionTranscription.mockReset();
});

describe("visionOcrPdf", () => {
  it("transcribes pages in batches and concatenates in order", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 5 });
    callAIVisionTranscription
      .mockResolvedValueOnce("BATCH-A")   // pages 1-4
      .mockResolvedValueOnce("BATCH-B");  // page 5

    const res = await visionOcrPdf(Buffer.from("pdf"), { maxPages: 30, model: "mini", batchSize: 4 });

    expect(res.pageCount).toBe(5);
    expect(res.pagesProcessed).toBe(5);
    expect(res.truncated).toBe(false);
    expect(res.text).toBe("BATCH-A\n\nBATCH-B");
    expect(renderPageAsImage).toHaveBeenCalledTimes(5);
  });

  it("caps at maxPages and reports truncated", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 10 });
    callAIVisionTranscription.mockResolvedValue("X");

    const res = await visionOcrPdf(Buffer.from("pdf"), { maxPages: 3, model: "mini", batchSize: 4 });

    expect(res.pageCount).toBe(10);
    expect(res.pagesProcessed).toBe(3);
    expect(res.truncated).toBe(true);
    expect(renderPageAsImage).toHaveBeenCalledTimes(3);
  });

  it("fails closed when AZURE_API_KEY is unset", async () => {
    vi.stubEnv("AZURE_API_KEY", "");
    await expect(
      visionOcrPdf(Buffer.from("pdf"), { maxPages: 30, model: "mini" }),
    ).rejects.toThrow(/AZURE_API_KEY/);
  });

  it("opens the document with a real canvas factory so scanned (image) pages can paint", async () => {
    // Regression: opening the document without a CanvasFactory leaves pdf.js
    // with a stub factory that throws "@napi-rs/canvas is not available" the
    // moment it paints an image XObject — i.e. every scanned page. The factory
    // must be resolved from our canvasImport and threaded into getDocumentProxy.
    getDocumentProxy.mockResolvedValue({ numPages: 1 });
    callAIVisionTranscription.mockResolvedValue("T");

    await visionOcrPdf(Buffer.from("pdf"), { maxPages: 30, model: "mini" });

    expect(createIsomorphicCanvasFactory).toHaveBeenCalledTimes(1);
    expect(createIsomorphicCanvasFactory.mock.calls[0][0]).toBeTypeOf("function");
    expect(getDocumentProxy.mock.calls[0][1]).toMatchObject({
      CanvasFactory: FAKE_CANVAS_FACTORY,
    });
  });

  it("interleaves rendering with transcription instead of rendering all pages up front", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 6 });
    // Record how many pages had been rendered at the moment each batch's
    // transcription was kicked off. Eager rendering would render all 6 pages
    // before the first transcription call (→ [6, 6, 6]); a pipeline renders
    // only one batch ahead (→ [2, 4, 6]).
    const rendersWhenTranscribed: number[] = [];
    callAIVisionTranscription.mockImplementation(async () => {
      rendersWhenTranscribed.push(renderPageAsImage.mock.calls.length);
      return "T";
    });

    await visionOcrPdf(Buffer.from("pdf"), {
      maxPages: 30,
      model: "mini",
      batchSize: 2,
      concurrency: 2,
    });

    expect(rendersWhenTranscribed).toEqual([2, 4, 6]);
  });

  it("stops rendering ahead once `concurrency` transcriptions are outstanding", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 8 });
    // Transcriptions never settle, so the in-flight window stays full and the
    // render loop must block rather than rasterize every remaining page.
    callAIVisionTranscription.mockReturnValue(new Promise<string>(() => {}));

    // Don't await — it would hang by design. Let the microtask queue drain.
    void visionOcrPdf(Buffer.from("pdf"), {
      maxPages: 30,
      model: "mini",
      batchSize: 2,
      concurrency: 2,
    });
    await new Promise((r) => setTimeout(r, 0));

    // Only the first concurrency*batchSize pages render; the rest wait behind
    // the full window — bounding peak memory to the in-flight JPEGs.
    expect(renderPageAsImage).toHaveBeenCalledTimes(4);
  });
});
