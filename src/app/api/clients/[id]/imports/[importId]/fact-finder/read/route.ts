// src/app/api/clients/[id]/imports/[importId]/fact-finder/read/route.ts
import { factFinderGate } from "@/lib/fact-finder/gate";
import { runFactFinderRead, type ReadEvent } from "@/lib/fact-finder/read-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

/**
 * Pass 1: read the import's unread files into the fact finder, streaming one
 * `file` event per file as it starts and settles, then `done` (or `error`).
 * Every gate resolves before the stream opens, so refusals are plain JSON.
 */
export async function POST(request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "extract");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId, imp } = gate;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ReadEvent | { type: "error"; message: string }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const onAbort = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", onAbort);
      try {
        const result = await runFactFinderRead({
          scope: { importId, clientId, firmId },
          extractHoldings: imp.extractHoldings === true,
          signal: request.signal,
          onEvent: send,
        });
        send({ type: "done", summary: result.summary, caveats: result.caveats, version: result.version });
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 200) : "Reading failed.";
        console.error(`POST /api/clients/${clientId}/imports/${importId}/fact-finder/read failed:`, message);
        send({ type: "error", message });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        if (!closed) controller.close();
      }
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
