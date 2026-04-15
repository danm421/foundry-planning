import { join } from "path";

/**
 * Extract text from a PDF buffer using pdfjs-dist directly.
 * Returns empty string if parsing fails.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) return "";

  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    // Point worker to the actual file in node_modules
    // Use require.resolve which works in both Node.js and Turbopack
    const workerPath = join(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require.resolve("pdfjs-dist/package.json").replace("package.json", ""),
      "legacy/build/pdf.worker.mjs"
    );
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;

    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = content.items
        .map((item: any) => (item.str as string) ?? "")
        .join(" ");
      pages.push(text);
    }

    return pages.join("\n");
  } catch (err) {
    console.error("[pdf-parser] Failed to extract text:", err);
    return "";
  }
}
