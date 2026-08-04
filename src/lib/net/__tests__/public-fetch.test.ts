import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// node:dns is mocked so the suite never depends on real resolution.
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import {
  assertPublicHttpsTarget,
  fetchPublicUrl,
  BlockedTargetError,
} from "@/lib/net/public-fetch";

function resolvesTo(...addresses: string[]) {
  lookupMock.mockResolvedValue(addresses.map((address) => ({ address, family: 4 })));
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  lookupMock.mockReset();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("assertPublicHttpsTarget", () => {
  it("allows a public https host", async () => {
    resolvesTo("93.184.216.34");
    await expect(
      assertPublicHttpsTarget(new URL("https://abc.public.blob.vercel-storage.com/logo.png")),
    ).resolves.toBeUndefined();
  });

  it("refuses non-https schemes", async () => {
    await expect(assertPublicHttpsTarget(new URL("http://example.com/x"))).rejects.toThrow(
      BlockedTargetError,
    );
    await expect(assertPublicHttpsTarget(new URL("file:///etc/passwd"))).rejects.toThrow(
      BlockedTargetError,
    );
  });

  it("refuses loopback, RFC1918 and link-local IP literals", async () => {
    for (const host of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "0.0.0.0"]) {
      await expect(assertPublicHttpsTarget(new URL(`https://${host}/x`))).rejects.toThrow(
        BlockedTargetError,
      );
    }
  });

  it("refuses the cloud metadata endpoints", async () => {
    await expect(
      assertPublicHttpsTarget(new URL("https://169.254.169.254/latest/meta-data/")),
    ).rejects.toThrow(BlockedTargetError);
    // Alibaba/CGNAT range.
    await expect(assertPublicHttpsTarget(new URL("https://100.100.100.200/x"))).rejects.toThrow(
      BlockedTargetError,
    );
  });

  it("refuses IPv6 loopback and unique-local literals", async () => {
    for (const host of ["[::1]", "[fd00::1]", "[fe80::1]"]) {
      await expect(assertPublicHttpsTarget(new URL(`https://${host}/x`))).rejects.toThrow(
        BlockedTargetError,
      );
    }
  });

  it("refuses an IPv4-mapped IPv6 loopback", async () => {
    await expect(
      assertPublicHttpsTarget(new URL("https://[::ffff:127.0.0.1]/x")),
    ).rejects.toThrow(BlockedTargetError);
  });

  it("refuses a public NAME that RESOLVES to an internal address", async () => {
    // The DNS trick: the host looks fine, the answer does not.
    resolvesTo("169.254.169.254");
    await expect(
      assertPublicHttpsTarget(new URL("https://metadata.attacker.test/x")),
    ).rejects.toThrow(BlockedTargetError);
  });

  it("refuses when only ONE of several answers is internal", async () => {
    // A split answer is still a usable primitive — the socket picks.
    resolvesTo("93.184.216.34", "127.0.0.1");
    await expect(assertPublicHttpsTarget(new URL("https://split.test/x"))).rejects.toThrow(
      BlockedTargetError,
    );
  });

  it("refuses a host that does not resolve", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertPublicHttpsTarget(new URL("https://nope.test/x"))).rejects.toThrow(
      BlockedTargetError,
    );
  });
});

describe("fetchPublicUrl", () => {
  it("returns a non-redirect response", async () => {
    resolvesTo("93.184.216.34");
    fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await fetchPublicUrl("https://cdn.test/logo.png");
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to another public target", async () => {
    resolvesTo("93.184.216.34");
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://cdn2.test/logo.png" } }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await fetchPublicUrl("https://cdn.test/logo.png");
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect that lands on an internal target", async () => {
    // The check has to re-run per hop — this is what `redirect: "manual"` buys.
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    await expect(fetchPublicUrl("https://cdn.test/logo.png")).rejects.toThrow(BlockedTargetError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stops a redirect loop rather than following forever", async () => {
    resolvesTo("93.184.216.34");
    fetchSpy.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://cdn.test/loop" } }),
    );
    await expect(fetchPublicUrl("https://cdn.test/loop")).rejects.toThrow(/redirects/);
  });

  it("never issues a request for a blocked initial target", async () => {
    await expect(fetchPublicUrl("https://127.0.0.1/x")).rejects.toThrow(BlockedTargetError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
