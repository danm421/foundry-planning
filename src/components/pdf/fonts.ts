// Registers the three SIL OFL families used by the PDF report with
// @react-pdf/renderer. Only static TTFs ship in `public/fonts/` — the renderer
// can't consume variable fonts. Idempotent: safe to call on every render path.

import { Font } from "@react-pdf/renderer";

let registered = false;

export function ensureFontsRegistered(): void {
  if (registered) return;
  Font.register({
    family: "Inter",
    fonts: [
      { src: `${process.cwd()}/public/fonts/Inter-Regular.ttf`, fontWeight: 400 },
      { src: `${process.cwd()}/public/fonts/Inter-Medium.ttf`, fontWeight: 500 },
      { src: `${process.cwd()}/public/fonts/Inter-SemiBold.ttf`, fontWeight: 600 },
      { src: `${process.cwd()}/public/fonts/Inter-Bold.ttf`, fontWeight: 700 },
    ],
  });
  Font.register({
    family: "JetBrains Mono",
    fonts: [
      { src: `${process.cwd()}/public/fonts/JetBrainsMono-Regular.ttf`, fontWeight: 400 },
      { src: `${process.cwd()}/public/fonts/JetBrainsMono-Medium.ttf`, fontWeight: 500 },
      { src: `${process.cwd()}/public/fonts/JetBrainsMono-SemiBold.ttf`, fontWeight: 600 },
    ],
  });
  Font.register({
    family: "Fraunces",
    fonts: [
      { src: `${process.cwd()}/public/fonts/Fraunces-Regular.ttf`, fontWeight: 400 },
      { src: `${process.cwd()}/public/fonts/Fraunces-Medium.ttf`, fontWeight: 500 },
      { src: `${process.cwd()}/public/fonts/Fraunces-SemiBold.ttf`, fontWeight: 600 },
    ],
  });
  registered = true;
}
