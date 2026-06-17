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

async function renderPageImages(
  buffer: Buffer,
  maxPages: number,
): Promise<{ images: VisionImage[]; pageCount: number; truncated: boolean }> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const sharp = (await import("sharp")).default;

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pageCount = pdf.numPages;
  const pagesToRender = Math.min(pageCount, maxPages);

  const images: VisionImage[] = [];
  for (let p = 1; p <= pagesToRender; p++) {
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
    images.push({ b64: jpeg.toString("base64"), mime: "image/jpeg" });
  }
  return { images, pageCount, truncated: pageCount > maxPages };
}

/**
 * Fallback OCR for PDFs with no embedded text layer. Renders each page to an
 * image, downscales it, and transcribes batches via the Azure OpenAI vision
 * deployment. Fails closed when Azure is unconfigured.
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

  const { images, pageCount, truncated } = await renderPageImages(
    buffer,
    opts.maxPages,
  );

  const batches: VisionImage[][] = [];
  for (let i = 0; i < images.length; i += batchSize) {
    batches.push(images.slice(i, i + batchSize));
  }

  const transcripts: string[] = new Array(batches.length).fill("");
  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    const out = await Promise.all(
      slice.map((b) => callAIVisionTranscription(b, opts.model)),
    );
    out.forEach((t, j) => {
      transcripts[i + j] = t;
    });
  }

  return {
    text: transcripts.join("\n\n"),
    pageCount,
    pagesProcessed: images.length,
    truncated,
  };
}
