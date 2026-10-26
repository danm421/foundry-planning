// src/app/api/clients/[id]/imports/[importId]/fact-finder/turn/route.ts
import { formatUsage, inUsageScope, newUsageReport, totalTokensOf } from "@/lib/ai/usage";
import { recordAudit } from "@/lib/audit";
import { TURN_BUSY_MESSAGE, type TurnBody, type TurnFrame } from "@/lib/fact-finder/api-types";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { FactFinderBusyError, FactFinderClosedError, FactFinderNotFoundError, loadFactFinder } from "@/lib/fact-finder/persist";
import { filesReading } from "@/lib/fact-finder/reading-status";
import { readFactFinderState } from "@/lib/fact-finder/state";
import { runWorksheetTurn } from "@/lib/fact-finder/worksheet/turn";

export const dynamic = "force-dynamic";
// Up to 40 tool calls plus a closing reply, each a model round trip — and a
// document read can OCR a scanned file. The turn starts no new round after 240 s.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

const MAX_MESSAGE_LENGTH = 4_000;

/**
 * One chat reply, streamed: a `progress` frame per tool line, then `done` (or
 * `error`). Its edits land in one write, and its Undo id comes back when it
 * changed something. Every gate resolves before the stream opens, so those
 * refusals are plain JSON; a failure of the reply itself is an `error` frame.
 */
export async function POST(request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "turn");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId } = gate;
  const scope = { importId, clientId, firmId };

  const body = (await request.json().catch(() => null)) as { message?: unknown; mode?: unknown; match?: unknown } | null;
  const mode = body?.mode === "compose" ? "compose" : "advisor";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const match = mode === "advisor" ? matchOf(body?.match) : undefined;
  if (mode === "advisor" && !message) return jsonResponse(400, { error: "A message is required." });
  if (message.length > MAX_MESSAGE_LENGTH) return jsonResponse(400, { error: "Message is too long." });
  if (filesReading(readFactFinderState(gate.payloadJson), new Date()).length > 0) {
    return jsonResponse(409, { error: TURN_BUSY_MESSAGE });
  }

  const encoder = new TextEncoder();
  // The advisor left: send nothing more (enqueue throws once the stream is cancelled). The reply still runs to its commit.
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Never throws: a throwing progress listener would abort the turn uncommitted.
      const send = (frame: TurnFrame) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          open = false;
        }
      };
      const usage = newUsageReport();
      try {
        const result = await inUsageScope(usage, () =>
          runWorksheetTurn({
            scope,
            mode,
            ...(mode === "advisor" && { message }),
            ...(match && { match }),
            onProgress: (line) => send({ type: "progress", line }),
          }),
        );
        console.log(`[fact-finder-turn] import ${importId}: ${formatUsage(usage)}`);
        await recordAudit({
          action: "import.chat.turn",
          resourceType: "client_import",
          resourceId: importId,
          clientId,
          firmId,
          metadata: { surface: "fact_finder", mode, toolCallCount: result.toolCallCount, ops: result.ops, totalTokens: totalTokensOf(usage) },
        });
        send({ type: "done", factFinder: result.factFinder, turnId: result.turnId });
      } catch (err) {
        send(await errorFrame(err, scope));
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/** A Match to plan's `match` (`TurnBody`): the table it names, or `{}` for every table; anything else isn't one. */
function matchOf(raw: unknown): TurnBody["match"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { tableId } = raw as { tableId?: unknown };
  return typeof tableId === "string" ? { tableId } : {};
}

async function errorFrame(err: unknown, scope: { importId: string; clientId: string; firmId: string }): Promise<TurnFrame> {
  if (err instanceof FactFinderNotFoundError) return { type: "error", message: err.message };
  // The save landed after the gate let this through: the saved fact finder, so the tab shows the closed view.
  if (err instanceof FactFinderClosedError) {
    const factFinder = await loadFactFinder(scope).catch(() => null);
    return { type: "error", message: err.message, ...(factFinder && { factFinder }) };
  }
  if (err instanceof FactFinderBusyError) return { type: "error", message: err.message };
  const safeMessage = err instanceof Error ? err.message : "unknown error";
  if (safeMessage === "ai_not_configured") return { type: "error", message: "The assistant is not configured for this firm yet." };
  console.error(`POST /api/clients/${scope.clientId}/imports/${scope.importId}/fact-finder/turn failed:`, safeMessage.slice(0, 200));
  return { type: "error", message: "Could not process that message. Please try again." };
}
