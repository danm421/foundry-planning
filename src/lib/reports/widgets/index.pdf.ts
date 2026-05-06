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
import "./monte-carlo-fan";           // screen-side
import "./monte-carlo-fan.pdf";       // pdf-side
import "./ai-analysis";               // screen-side
import "./ai-analysis.pdf";           // pdf-side
import "./recommended-changes-table";        // screen-side
import "./recommended-changes-table.pdf";    // pdf-side
import "./key-indicators-callout";           // screen-side
import "./key-indicators-callout.pdf";       // pdf-side
import "./status-callout";                   // screen-side
import "./status-callout.pdf";               // pdf-side
import "./risk-table";                       // screen-side
import "./risk-table.pdf";                   // pdf-side
import "./risk-severity-bar";                // screen-side
import "./risk-severity-bar.pdf";            // pdf-side
import "./policies-table";                   // screen-side
import "./policies-table.pdf";               // pdf-side
import "./life-phases-table";                // screen-side
import "./life-phases-table.pdf";            // pdf-side
import "./expense-detail-table";             // screen-side
import "./expense-detail-table.pdf";         // pdf-side
import "./tax-bracket-chart";                // screen-side
import "./tax-bracket-chart.pdf";            // pdf-side
import "./action-items-list";                // screen-side
import "./action-items-list.pdf";            // pdf-side
import "./disclaimer-block";                 // screen-side
import "./disclaimer-block.pdf";             // pdf-side
import "./portfolio-comparison-line";        // screen-side
import "./portfolio-comparison-line.pdf";    // pdf-side
import "./monte-carlo-comparison-bars";      // screen-side
import "./monte-carlo-comparison-bars.pdf";  // pdf-side
import "./comparison-donut-pair";            // screen-side
import "./comparison-donut-pair.pdf";        // pdf-side
// each widget that has a PDF renderer adds a `import "./<name>.pdf";` line here
