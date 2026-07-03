// Loading boundary for the entire client portal. Sits below portal/layout.tsx
// (the nav rail / mobile tab bar), so navigating between portal tabs keeps the
// nav in place and paints this skeleton in the content area instantly. Every
// portal page is an async, no-Suspense server page, so this covers all of them.
export { default } from "@/components/skeleton/portal-loading";
