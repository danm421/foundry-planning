// src/lib/reports/widgets/index.pdf.ts
//
// PDF-side side-effect barrel. Imported from the export-pdf route via
// `components/reports-pdf/document.tsx`. Loads BOTH the screen-side glue
// (which creates each registry entry) AND the PDF-side glue (which
// attaches `RenderPdf` to each existing entry).
//
// The screen builder keeps importing the screen-only `./index.ts`, so
// the @react-pdf/renderer runtime never reaches the client bundle.

import "./kpi-tile";          // screen-side (defines the entry)
import "./kpi-tile.pdf";      // pdf-side (attaches RenderPdf to existing entry)
import "./cover";             // screen-side (defines the entry)
import "./cover.pdf";         // pdf-side (attaches RenderPdf to existing entry)
// each widget that has a PDF renderer adds a `import "./<name>.pdf";` line here
