// src/lib/extraction/vision-ocr.ts
import { callAIVisionTranscription, type VisionImage } from "./azure-client";

const DEFAULT_BATCH = 4;
const DEFAULT_CONCURRENCY = 3;
const RENDER_SCALE = 2.0; // ~150 DPI from a 72pt page base
const MAX_LONG_EDGE = 1600; // px — bounds vision-token cost
const JPEG_QUALITY = 70;

export interface VisionOcrResult {
  text: string;
  pageCount: number;
  pagesProcessed: number;
  truncated: boolean;
}

export interface VisionOcrOptions {
  maxPages: number;
  model: "mini" | "full";
  batchSize?: number;
  concurrency?: number;
}

/**
 * Fallback OCR for PDFs with no embedded text layer. Renders each page to a
 * downscaled JPEG and transcribes it via the Azure OpenAI vision deployment.
 *
 * Rendering (CPU-bound) is pipelined against transcription (I/O-bound): each
 * batch's transcription is launched without awaiting it, so the next batch
 * renders while up to `concurrency` transcriptions are in flight. This bounds
 * both wall-clock time and peak memory — we never hold more than the in-flight
 * window of rendered JPEGs at once, rather than every page up front. Fails
 * closed when Azure is unconfigured.
 */
export async function visionOcrPdf(
  buffer: Buffer,
  opts: VisionOcrOptions,
): Promise<VisionOcrResult> {
  if (!process.env.AZURE_API_KEY) {
    throw new Error("AZURE_API_KEY is not configured — vision OCR unavailable.");
  }
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const sharp = (await import("sharp")).default;

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pageCount = pdf.numPages;
  const pagesToRender = Math.min(pageCount, opts.maxPages);

  async function renderPage(p: number): Promise<VisionImage> {
    const raw = await renderPageAsImage(pdf, p, {
      scale: RENDER_SCALE,
      // unpdf accepts a canvas factory import; @napi-rs/canvas ships a
      // prebuilt native binary that runs on Vercel Fluid Compute.
      canvasImport: () =>
        import("@napi-rs/canvas") as unknown as Promise<
          typeof import("@napi-rs/canvas")
        >,
    });
    const jpeg = await sharp(Buffer.from(raw as ArrayBuffer))
      .resize({
        width: MAX_LONG_EDGE,
        height: MAX_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return { b64: jpeg.toString("base64"), mime: "image/jpeg" };
  }

  const transcripts: string[] = [];
  let batchIndex = 0;
  // index → in-flight transcription; entries delete themselves on settle so we
  // can await the oldest (Promise.race) whenever the window is full.
  const inFlight = new Map<number, Promise<number>>();

  for (let start = 1; start <= pagesToRender; start += batchSize) {
    const end = Math.min(start + batchSize - 1, pagesToRender);
    const batch: VisionImage[] = [];
    for (let p = start; p <= end; p++) batch.push(await renderPage(p));

    const index = batchIndex++;
    const task = callAIVisionTranscription(batch, opts.model).then((text) => {
      transcripts[index] = text;
      return index;
    });
    inFlight.set(
      index,
      task.then((settled) => {
        inFlight.delete(settled);
        return settled;
      }),
    );
    if (inFlight.size >= concurrency) await Promise.race(inFlight.values());
  }
  await Promise.all(inFlight.values());

  return {
    text: transcripts.join("\n\n"),
    pageCount,
    pagesProcessed: pagesToRender,
    truncated: pageCount > opts.maxPages,
  };
}
