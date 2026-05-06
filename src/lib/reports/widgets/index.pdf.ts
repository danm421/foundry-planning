// src/lib/reports/widgets/index.pdf.ts
//
// PDF-side side-effect barrel. Imported from the export-pdf route via
// `components/reports-pdf/document.tsx`. Loads BOTH the screen-side glue
// (which creates each registry entry) AND the PDF-side glue (which
// attaches `RenderPdf` to each existing entry).
//
// The screen builder keeps importing the screen-only `./index.ts`, so
// the @react-pdf/renderer runtime never reaches the client bundle.

import "./kpi-tile";              // screen-side (defines the entry)
import "./kpi-tile.pdf";          // pdf-side (attaches RenderPdf to existing entry)
import "./cover";                 // screen-side (defines the entry)
import "./cover.pdf";             // pdf-side (attaches RenderPdf to existing entry)
import "./section-head";          // screen-side
import "./section-head.pdf";      // pdf-side
import "./divider";               // screen-side
import "./divider.pdf";           // pdf-side
import "./advisor-commentary";    // screen-side
import "./advisor-commentary.pdf"; // pdf-side
import "./cashflow-bar-chart";    // screen-side
import "./cashflow-bar-chart.pdf"; // pdf-side
import "./cashflow-table";        // screen-side
import "./cashflow-table.pdf";    // pdf-side
import "./income-sources-area";       // screen-side
import "./income-sources-area.pdf";   // pdf-side
import "./net-worth-line";            // screen-side
import "./net-worth-line.pdf";        // pdf-side
import "./balance-sheet-table";       // screen-side
import "./balance-sheet-table.pdf";   // pdf-side
import "./allocation-donut";          // screen-side
import "./allocation-donut.pdf";      // pdf-side
// each widget that has a PDF renderer adds a `import "./<name>.pdf";` line here
