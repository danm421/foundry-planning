// src/app/api/knowledge-hub/videos/[slug]/route.ts
//
// Streams a Knowledge Hub help video from private Blob in ≤ 2 MB pieces
// (206 Partial Content), so the player can jump to any chapter — Safari won't
// play video at all without range support. The slug must be in the reviewed
// details files, and the storage path always comes from there, never from the
// request. ?v= must be the current content hash: a page loaded before a
// re-shoot gets a 404 rather than the new file's bytes spliced into the old.
import { get } from "@vercel/blob";
import { forgeViewerGate } from "@/lib/forge-access";
import { getHelpVideo } from "@/domain/forge/help/videos";
import { parseByteRange } from "@/lib/knowledge-hub/byte-range";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = await forgeViewerGate();
  if (denied) return denied;

  const { slug } = await ctx.params;
  const video = getHelpVideo(slug);
  if (!video || new URL(req.url).searchParams.get("v") !== video.video.sha256.slice(0, 12)) {
    return new Response("Not found", { status: 404 });
  }

  const size = video.video.bytes;
  const range = parseByteRange(req.headers.get("range"), size);
  if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

  const result = await get(video.video.path, {
    access: "private",
    headers: { Range: `bytes=${range.start}-${range.end}` },
  });
  if (!result || result.statusCode !== 200 || !result.stream) return new Response("Not found", { status: 404 });

  const contentRange = `bytes ${range.start}-${range.end}/${size}`;
  if (result.headers.get("content-range") !== contentRange) {
    await result.stream.cancel();
    console.error("knowledge-hub: storage ignored the range", { slug, asked: contentRange, got: result.headers.get("content-range") });
    return new Response("Bad gateway", { status: 502 });
  }

  return new Response(result.stream, {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": contentRange,
      "Content-Length": String(range.end - range.start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
