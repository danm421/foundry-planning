// Client-side helper: converts a rendered Chart.js canvas into a PNG data-URI
// for the export route to embed in the PDF. Tainted canvases throw on
// toDataURL — we'd rather skip the chart than fail the export.

export function canvasToPng(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
