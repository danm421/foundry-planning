// src/app/api/knowledge-hub/videos/[slug]/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ gate: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/forge-access", () => ({ forgeViewerGate: m.gate }));
vi.mock("@vercel/blob", () => ({ get: m.get }));
vi.mock("@/domain/forge/help/videos", async () => {
  const f = await import("@/domain/forge/help/__tests__/help-video-fixtures");
  return { getHelpVideo: (s: string) => [f.EXPENSE_VIDEO].find((v) => v.slug === s) };
});

import { GET } from "../route";
import { EXPENSE_VIDEO as V } from "@/domain/forge/help/__tests__/help-video-fixtures";

const SIZE = V.video.bytes;
const v12 = V.video.sha256.slice(0, 12);
const url = (slug = V.slug, v = v12) => `http://x/api/knowledge-hub/videos/${slug}?v=${v}`;
const req = (u: string, range?: string) => new Request(u, range ? { headers: { range } } : undefined);
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const stream = () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } });
const stored = (contentRange: string | null) => ({
  statusCode: 200,
  stream: stream(),
  headers: new Headers(contentRange ? { "content-range": contentRange } : {}),
  blob: {},
});

beforeEach(() => {
  m.gate.mockReset().mockResolvedValue(null);
  m.get.mockReset();
});

describe("GET /api/knowledge-hub/videos/[slug]", () => {
  it("returns the gate's response when access is denied, without touching storage", async () => {
    m.gate.mockResolvedValue(new Response("Not found", { status: 404 }));
    const res = await GET(req(url(), "bytes=0-1"), params(V.slug));
    expect(res.status).toBe(404);
    expect(m.get).not.toHaveBeenCalled();
  });

  it("404s an unknown slug", async () => {
    expect((await GET(req(url("nope"), "bytes=0-1"), params("nope"))).status).toBe(404);
  });

  it("404s a stale ?v= (the video was re-shot since the page loaded)", async () => {
    expect((await GET(req(url(V.slug, "000000000000"), "bytes=0-1"), params(V.slug))).status).toBe(404);
    expect(m.get).not.toHaveBeenCalled();
  });

  it("serves Safari's 2-byte probe as a 206 with exact headers", async () => {
    m.get.mockResolvedValue(stored(`bytes 0-1/${SIZE}`));
    const res = await GET(req(url(), "bytes=0-1"), params(V.slug));
    expect(res.status).toBe(206);
    expect(m.get).toHaveBeenCalledWith(V.video.path, { access: "private", headers: { Range: "bytes=0-1" } });
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-1/${SIZE}`);
    expect(res.headers.get("Content-Length")).toBe("2");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("ETag")).toBe(`"${v12}"`);
  });

  it("caps a request without Range at the first 2 MB", async () => {
    m.get.mockResolvedValue(stored(`bytes 0-2097151/${SIZE}`));
    const res = await GET(req(url()), params(V.slug));
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Length")).toBe("2097152");
  });

  it("416s an unsatisfiable range", async () => {
    const res = await GET(req(url(), `bytes=${SIZE + 10}-`), params(V.slug));
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe(`bytes */${SIZE}`);
  });

  it("502s when storage ignored the range (never send a wrong-sized body)", async () => {
    m.get.mockResolvedValue(stored(null));
    expect((await GET(req(url(), "bytes=0-1"), params(V.slug))).status).toBe(502);
  });

  it("404s when the file is missing from storage", async () => {
    m.get.mockResolvedValue(null);
    expect((await GET(req(url(), "bytes=0-1"), params(V.slug))).status).toBe(404);
  });

  it("502s when storage throws, logging the slug and range but not the error's token or URL", async () => {
    m.get.mockRejectedValue(new Error("Vercel Blob: 503 at https://store.example/secret?token=vercel_blob_rw_SECRET"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await GET(req(url(), "bytes=0-1"), params(V.slug))).status).toBe(502);
      expect(log).toHaveBeenCalledWith("knowledge-hub: storage read failed", { slug: V.slug, range: "bytes=0-1" });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|https:/);
    } finally {
      log.mockRestore();
    }
  });
});
