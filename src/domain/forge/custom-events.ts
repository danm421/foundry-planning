// Typed seam for structured (generative-UI / navigation / activity) stream frames.
// PLUMBING ONLY — no renderers yet. Emits via dispatchCustomEvent so the frames
// surface as on_custom_event in graph.streamEvents(v2). Payloads must already be
// account-masked/grounded by the caller (same contract as the text path).
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

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
export type ForgeCustomFrame = ToolRenderFrame | NavigateFrame | ActivityFrame | PageLinkFrame;

/** Only in-app paths may be navigated; never an external URL. */
export const NAVIGATE_ALLOWLIST_PREFIXES = ["/clients/", "/cma/"];

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
