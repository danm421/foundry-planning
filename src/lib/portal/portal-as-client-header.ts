/**
 * Header an advisor's browser sends in preview to act as a specific client.
 *
 * Lives in its own leaf module (no `next/headers` / Clerk imports) so the
 * client-side portal-mode context can reference the constant without dragging
 * the server-only `resolve-portal-client` module into the browser bundle.
 */
export const PORTAL_AS_CLIENT_HEADER = "x-portal-as-client";
