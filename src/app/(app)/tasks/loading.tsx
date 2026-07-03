// Loading boundary for /tasks — an async page that Promise.all's ~7 queries
// before returning its `p-6` → <h1>Tasks</h1> → table markup with no Suspense,
// so without this the previous page freezes for the whole DB window.
export { default } from "@/components/skeleton/list-loading";
