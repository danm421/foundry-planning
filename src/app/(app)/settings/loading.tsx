// Loading boundary for the settings section. Sits below settings/layout.tsx,
// so it keeps the settings tab strip on screen and skeletons only the content
// area — covering /settings/integrations (async, no in-page Suspense), the auth
// await that gates the branding/firm pages, and instant paint on sibling-tab nav.
export { default } from "@/components/skeleton/form-loading";
