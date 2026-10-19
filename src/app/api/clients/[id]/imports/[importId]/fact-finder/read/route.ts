// src/app/api/clients/[id]/imports/[importId]/fact-finder/read/route.ts
import { READ_BUSY_MESSAGE, type ReadFrame } from "@/lib/fact-finder/api-types";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { FactFinderBusyError, FactFinderNotFoundError } from "@/lib/fact-finder/persist";
import { READ_BUDGET_MS, runFactFinderRead } from "@/lib/fact-finder/read-run";
import { filesReading } from "@/lib/fact-finder/reading-status";
import { readFactFinderState } from "@/lib/fact-finder/state";
import { safeErrorFields } from "@/lib/redaction/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

const READING_STOPPED = "Reading stopped — try again.";

/**
 * Pass 1: read the import's unread files into the fact finder, streaming one
 * `file` event per file as it starts and settles, then `done` (or `error`).
 * Every gate resolves before the stream opens, so refusals are plain JSON —
 * including the 409 while another read of this import is under way. After
 * READ_BUDGET_MS the read starts no new files, so it still ends with `done`
 * (naming the files left to retry) before maxDuration.
 */
export async function POST(request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "extract");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId, imp } = gate;
  if (filesReading(readFactFinderState(gate.payloadJson), new Date()).length > 0) {
    return jsonResponse(409, { error: READ_BUSY_MESSAGE });
  }

  const encoder = new TextEncoder();
  // The advisor left: stop the read and send nothing more (enqueue throws once the stream is cancelled).
  const cancelled = new AbortController();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: ReadFrame) => {
        if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };
      try {
        const result = await runFactFinderRead({
          scope: { importId, clientId, firmId },
          extractHoldings: imp.extractHoldings === true,
          signal: AbortSignal.any([request.signal, cancelled.signal, AbortSignal.timeout(READ_BUDGET_MS)]),
          onEvent: send,
        });
        send({ type: "done", summary: result.summary, caveats: result.caveats, version: result.version });
      } catch (err) {
        console.error(`POST /api/clients/${clientId}/imports/${importId}/fact-finder/read failed:`, safeErrorFields(err));
        // The fact finder's own refusals (busy, saved — FactFinderClosedError is a busy one — or gone) are
        // written for the advisor; any other error's text is never sent.
        const plain = err instanceof FactFinderBusyError || err instanceof FactFinderNotFoundError;
        send({ type: "error", message: plain ? err.message : READING_STOPPED });
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
      cancelled.abort();
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
