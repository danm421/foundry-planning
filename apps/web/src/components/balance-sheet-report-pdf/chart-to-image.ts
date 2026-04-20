// Turns a chart.js canvas into a PNG data URL for embedding in react-pdf.
// Keep the logic trivial — complexity here would indicate we should be doing
// server-side chart rendering instead (we're not, for deployment simplicity).

export function canvasToPng(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch {
    // canvas.toDataURL can throw SecurityError on cross-origin contamination.
    // We control all canvases here, so this should never fire — but fail soft.
    return null;
  }
}
