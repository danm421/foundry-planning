import type { McpTool } from "../define-tool";
import { discoveryTools } from "./discovery";
import { householdTools } from "./household";
import { planTools } from "./plan";
import { analysisTools } from "./analysis";

/**
 * Every tool the Foundry connector exposes. All read-only by construction —
 * `defineTool` is the only way to build one and it hard-codes the
 * annotations. This is the one place all four Task 8-11 tool arrays are
 * imported; `src/app/api/mcp/route.ts` mounts this array on the wire.
 *
 * 2 discovery + 4 household + 6 plan + 5 analysis = 17.
 */
export const ALL_MCP_TOOLS: McpTool[] = [
  ...discoveryTools,
  ...householdTools,
  ...planTools,
  ...analysisTools,
];
