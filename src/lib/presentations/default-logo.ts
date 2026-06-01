import { readFile } from "node:fs/promises";

// The cream-panel cover logo when a firm hasn't uploaded their own. This is the
// light-theme Foundry lockup (dark "Foundry." wordmark on a light tile) so it
// reads on the cover's cream panel. Returned as a base64 data URL — the same
// shape `resolveBranding` produces for firm logos — so the cover component
// consumes one uniform `<Image src>` regardless of source.
//
// Server-only: reads from `public/` via cwd (mirrors the font-loading pattern in
// `components/pdf/fonts.ts`). Cached after the first read; the asset never
// changes within a process.

const LOGO_PATH = `${process.cwd()}/public/brand/lockup-horizontal-light.png`;

let cached: string | null = null;

export async function foundryDefaultLogoDataUrl(): Promise<string> {
  if (cached) return cached;
  const buf = await readFile(LOGO_PATH);
  cached = `data:image/png;base64,${buf.toString("base64")}`;
  return cached;
}
