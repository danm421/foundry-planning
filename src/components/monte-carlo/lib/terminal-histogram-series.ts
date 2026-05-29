// Pure binning math now lives framework-free under src/lib so server route
// handlers (PDF export) can import it without crossing the components boundary.
export * from "@/lib/monte-carlo/histogram-series";
