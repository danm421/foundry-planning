// Cheap catch-all loading boundary for the internal admin area. Renders inside
// admin/layout.tsx's padded `max-w-5xl` container while async admin pages
// (e.g. /admin/orgs) resolve their queries.
export { default } from "@/components/skeleton/section-loading";
