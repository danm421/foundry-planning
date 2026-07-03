// Catch-all loading boundary for standalone advisor-app pages that block on
// server awaits with no in-page <Suspense> (e.g. /crm/households/[id],
// meeting-prep). Sits directly below (app)/layout.tsx, so on client-side
// navigation the sidebar/topbar shell stays put and this skeleton paints in
// <main> instantly. Closer boundaries — [id]/loading.tsx, the shaped overrides
// below, and any page-level <Suspense> — always win over this one. Sync client
// shells (/cma, /crm) don't suspend server-side, so their render is unaffected.
export { default } from "@/components/skeleton/section-loading";
