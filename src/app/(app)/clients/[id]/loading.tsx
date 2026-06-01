// Route-level loading boundary for top-level client tabs (Overview, Details,
// Assets, Cash Flow, Solver, Analysis, Estate Planning, Comparison,
// Presentations). Sits just below `[id]/layout.tsx`, so it paints instantly
// when a tab is clicked while the destination page resolves its auth + client
// lookup. Sub-tabbed segments add their own boundary below their subtab layout.
export { default } from "@/components/skeleton/section-loading";
