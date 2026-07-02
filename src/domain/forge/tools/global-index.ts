// src/domain/forge/tools/global-index.ts
//
// The GLOBAL tool set — the ONLY tools a clientless (off-client) Forge thread
// can call. Hardcoded: it cannot construct any client-scoped tool, so a global
// thread can never read or mutate client data. Plan 1 ships read-only help +
// navigation; Plan 2 adds the agentic global-action bundle here.
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ForgeGlobalToolContext } from "../context";
import { buildHelpTools } from "./help";
import { buildGlobalNavigateTools } from "./navigate-global";
import { buildGlobalActionTools } from "./global-actions";
import { buildWalkthroughTools } from "./walkthrough";

export function buildGlobalTools(toolCtx: ForgeGlobalToolContext): StructuredToolInterface[] {
  return [
    ...buildHelpTools(toolCtx),
    ...buildGlobalNavigateTools(toolCtx),
    ...buildGlobalActionTools(toolCtx),
    ...buildWalkthroughTools(toolCtx),
  ];
}
