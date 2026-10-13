// src/app/api/clients/[id]/imports/[importId]/fact-finder/turn/route.ts
import { formatUsage, inUsageScope, newUsageReport, totalTokensOf } from "@/lib/ai/usage";
import { recordAudit } from "@/lib/audit";
import { TURN_BUSY_MESSAGE, type TurnResponse } from "@/lib/fact-finder/api-types";
import { runFactFinderTurn } from "@/lib/fact-finder/chat/turn";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { FactFinderBusyError, FactFinderNotFoundError } from "@/lib/fact-finder/persist";
import { filesReading } from "@/lib/fact-finder/reading-status";
import { readFactFinderState } from "@/lib/fact-finder/state";

export const dynamic = "force-dynamic";
// Up to 12 tool calls plus a closing reply, each a model round trip — and a
// re-read can OCR a scanned document.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

const MAX_MESSAGE_LENGTH = 4_000;

/** One chat reply: its edits land in one write, and its Undo id comes back when it changed something. */
export async function POST(request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "turn");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId } = gate;

  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return jsonResponse(400, { error: "A message is required." });
  if (message.length > MAX_MESSAGE_LENGTH) return jsonResponse(400, { error: "Message is too long." });
  if (filesReading(readFactFinderState(gate.payloadJson), new Date()).length > 0) {
    return jsonResponse(409, { error: TURN_BUSY_MESSAGE });
  }

  const usage = newUsageReport();
  let result: Awaited<ReturnType<typeof runFactFinderTurn>>;
  try {
    result = await inUsageScope(usage, () => runFactFinderTurn({ scope: { importId, clientId, firmId }, message }));
  } catch (err) {
    if (err instanceof FactFinderNotFoundError) return jsonResponse(404, { error: err.message });
    if (err instanceof FactFinderBusyError) return jsonResponse(409, { error: err.message });
    const safeMessage = err instanceof Error ? err.message : "unknown error";
    if (safeMessage === "ai_not_configured") {
      return jsonResponse(503, { error: "The assistant is not configured for this firm yet." });
    }
    console.error(`POST /api/clients/${clientId}/imports/${importId}/fact-finder/turn failed:`, safeMessage.slice(0, 200));
    return jsonResponse(500, { error: "Could not process that message. Please try again." });
  }

  console.log(`[fact-finder-turn] import ${importId}: ${formatUsage(usage)}`);
  await recordAudit({
    action: "import.chat.turn",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    metadata: { surface: "fact_finder", toolCallCount: result.toolCallCount, ops: result.ops, totalTokens: totalTokensOf(usage) },
  });
  return jsonResponse(200, { factFinder: result.factFinder, turnId: result.turnId } satisfies TurnResponse);
}
