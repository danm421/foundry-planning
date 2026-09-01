// src/app/(setup)/welcome/derive-logo-color.ts
import { dominantColorFromPixels } from "./dominant-color";

/**
 * The browser half of the colour suggestion: turn a chosen logo file into a
 * hex, so the advisor never has to think about hex codes.
 *
 * It lives here rather than inside the form so the form can take it as a
 * parameter. jsdom has no canvas and never decodes an image, so a sampler
 * baked into the component is a promise that silently never settles — which is
 * exactly how the "never overwrite a colour they picked themselves" guard
 * shipped with no test able to see it.
 */

const SAMPLE_PX = 64;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode image"));
    img.src = src;
  });
}

/**
 * Draw the logo into a small offscreen canvas and read its dominant colour.
 * Any failure — a browser that blocks canvas reads, an image it cannot decode
 * — degrades to the manual picker, never to a broken page.
 */
export async function deriveColorFromFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_PX;
    canvas.height = SAMPLE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_PX, SAMPLE_PX);
    return dominantColorFromPixels(ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
