/**
 * `outputFileTracingIncludes` for next.config.ts — kept in its own module so
 * the deploy-critical route→files map can be unit-tested without importing
 * next.config.ts (which boots @sentry/nextjs on import).
 *
 * Keys are picomatch route globs matched against the route path; `*` matches
 * one literal segment, so it stands in for `[id]`. Values are globs resolved
 * from the project root.
 */

/**
 * @react-pdf font registration (src/components/pdf/fonts.ts) reads the TTFs
 * from public/fonts at runtime via `${process.cwd()}/…`, which output file
 * tracing can't statically follow — deployed functions ENOENT'd on
 * /var/task/public/fonts/Inter-Regular.ttf. ~2.7MB per bundle.
 */
export const PDF_FONT_FILES = ["public/fonts/*.ttf"];

/**
 * @napi-rs/canvas is opted out of bundling (`serverExternalPackages`) *and*
 * its dynamic import in src/lib/extraction/vision-ocr.ts carries
 * turbopackIgnore/webpackIgnore to keep the prebuilt `.node` binary out of an
 * ESM chunk — between them nothing traced the package, so the deployed
 * function shipped without it and every scanned-PDF OCR attempt died with
 * `Cannot find package '@napi-rs/canvas'` (production, 2026-08-20). Trace the
 * loader plus whichever prebuilt platform package the builder installed
 * (linux-x64-gnu on Vercel; npm only installs the matching one). ~25MB per
 * bundle, so this is scoped to the routes that can rasterize a PDF page
 * rather than applied globally.
 */
export const OCR_CANVAS_FILES = [
    "node_modules/@napi-rs/canvas/**/*",
    "node_modules/@napi-rs/canvas-*/**/*",
];

export const outputFileTracingIncludes: Record<string, string[]> = {
    "/api/clients/*/exports/pdf": PDF_FONT_FILES,
    "/api/clients/*/presentations/*": PDF_FONT_FILES,
    "/api/clients/*/liquidity-report/export-pdf": PDF_FONT_FILES,
    "/api/clients/*/balance-sheet-report/export-pdf": PDF_FONT_FILES,
    "/api/clients/*/tax-returns/*/export-pdf": PDF_FONT_FILES,
    "/api/crm/households/*/meeting-prep/export": PDF_FONT_FILES,
    // Forge's report tool renders artifact PDFs inside the chat routes, and its
    // document-read tool runs the same extraction pipeline — both file sets.
    "/api/forge/stream": [...PDF_FONT_FILES, ...OCR_CANVAS_FILES],
    "/api/forge/resume": [...PDF_FONT_FILES, ...OCR_CANVAS_FILES],

    // Routes whose module graph reaches src/lib/extraction/vision-ocr.ts, i.e.
    // that can rasterize a PDF page. Kept in sync by
    // src/lib/extraction/__tests__/ocr-canvas-tracing.test.ts, which walks the
    // import graph — add a route there and that test tells you to add it here.
    "/api/clients/*/forge/*": OCR_CANVAS_FILES,
    "/api/clients/*/imports/*/extract": OCR_CANVAS_FILES,
    "/api/clients/*/imports/*/files/*/extract": OCR_CANVAS_FILES,
    "/api/clients/*/rebalance/extract-holdings": OCR_CANVAS_FILES,
    "/api/clients/*/tax-returns": OCR_CANVAS_FILES,
    "/api/clients/*/tax-returns/*/documents": OCR_CANVAS_FILES,
    "/api/clients/*/tax-returns/*/second-read": OCR_CANVAS_FILES,
    "/api/forge/fact-finder/identify": OCR_CANVAS_FILES,
};
