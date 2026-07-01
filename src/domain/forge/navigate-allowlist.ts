// Pure data — NO LangChain import — so client components (forge-panel) can
// import the nav guard without dragging @langchain/core (which needs
// node:async_hooks) into the browser bundle. custom-events.ts re-exports this
// for server callers so the emit-side keeps a single import site.

/** Only in-app paths may be navigated; never an external URL. Covers the
 *  advisor app's navigable surface (client + global product-help targets). */
export const NAVIGATE_ALLOWLIST_PREFIXES = [
  "/clients",
  "/cma",
  "/crm",
  "/tasks",
  "/data-collection",
  "/settings",
];
