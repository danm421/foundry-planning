// Typed seam for structured (generative-UI / navigation / activity) stream frames.
// PLUMBING ONLY — no renderers yet. Emits via dispatchCustomEvent so the frames
// surface as on_custom_event in graph.streamEvents(v2). Payloads must already be
// account-masked/grounded by the caller (same contract as the text path).
//
// server-only: dispatchCustomEvent pulls in @langchain/core (node:async_hooks),
// which cannot be bundled for the browser. Client callers must import the pure
// NAVIGATE_ALLOWLIST_PREFIXES from ./navigate-allowlist instead of this module.
import "server-only";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { NAVIGATE_ALLOWLIST_PREFIXES } from "./navigate-allowlist";
import { getWalkthrough } from "./help/catalog";

// Re-exported so existing server callers (tools/navigate*, custom-events.test)
// keep importing the allowlist from here unchanged.
export { NAVIGATE_ALLOWLIST_PREFIXES };

export interface ToolRenderFrame {
  type: "tool_render";
  name: string;
  status: "inProgress" | "complete";
  data: unknown;
}
export interface NavigateFrame {
  type: "navigate";
  href: string;
}
export interface ActivityFrame {
  type: "activity";
  label: string;
}
export interface PageLinkFrame {
  type: "page_link";
  href: string;
  section: string;
  label: string;
}
export interface WalkthroughFrame {
  type: "walkthrough";
  walkthroughId: string;
}
export type ForgeCustomFrame =
  | ToolRenderFrame
  | NavigateFrame
  | ActivityFrame
  | PageLinkFrame
  | WalkthroughFrame;

export async function emitToolRender(name: string, status: ToolRenderFrame["status"], data: unknown) {
  await dispatchCustomEvent("tool_render", { name, status, data });
}
export async function emitNavigate(href: string) {
  if (!NAVIGATE_ALLOWLIST_PREFIXES.some((p) => href.startsWith(p))) {
    throw new Error("navigate href not allowlisted");
  }
  await dispatchCustomEvent("navigate", { href });
}
export async function emitActivity(label: string) {
  await dispatchCustomEvent("activity", { label });
}
/** Emit a non-navigating deep link the client attaches to the answer as a chip.
 *  Same allowlist guard as emitNavigate (defence in depth); the advisor is NOT
 *  routed — the chip is rendered for them to click. */
export async function emitPageLink(href: string, section: string, label: string) {
  if (!NAVIGATE_ALLOWLIST_PREFIXES.some((p) => href.startsWith(p))) {
    throw new Error("page_link href not allowlisted");
  }
  await dispatchCustomEvent("page_link", { href, section, label });
}
/** Emit a request for the client to start an on-screen guided walkthrough.
 *  The id is re-validated against the catalog here (defence in depth) — the
 *  model can never trigger a tour that isn't curated. */
export async function emitWalkthrough(walkthroughId: string) {
  if (!getWalkthrough(walkthroughId)) {
    throw new Error("unknown walkthrough id");
  }
  await dispatchCustomEvent("walkthrough", { walkthroughId });
}
