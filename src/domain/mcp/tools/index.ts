import type { McpTool } from "../define-tool";
import { discoveryTools } from "./discovery";
import { householdTools } from "./household";
import { planTools } from "./plan";
import { analysisTools } from "./analysis";
import { notesTools } from "./notes";
import { whatifTools } from "./whatif";
import { projectionDataTools } from "./projection-data";
import { scenarioWriteTools } from "./scenario-writes";
import { presentationTools } from "./presentations";

/**
 * Every tool the Foundry connector exposes. Read tools are built with
 * defineTool, which hard-codes read-only annotations; the write tools with
 * defineWriteTool, which adds the firm switch and the edit-access gate.
 * src/app/api/mcp/route.ts mounts this array on the wire.
 *
 * 2 discovery + 4 household + 6 plan + 4 analysis + 2 notes + 3 what-if + 1 projection data + 1 scenario write + 3 presentations = 26.
 */
export const ALL_MCP_TOOLS: McpTool[] = [
  ...discoveryTools,
  ...householdTools,
  ...planTools,
  ...analysisTools,
  ...notesTools,
  ...whatifTools,
  ...projectionDataTools,
  ...scenarioWriteTools,
  ...presentationTools,
];
