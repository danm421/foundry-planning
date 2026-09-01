import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GET } from "../route";

const ENV = {
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
} as const;

function makeRequest(query = "") {
  return new Request(`https://app.example.test/api/checkout/start${query}`);
}

describe("GET /api/checkout/start", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
    Object.assign(process.env, ENV);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("forwards to sign-up, where signup now begins", async () => {
    const res = await GET(makeRequest("?plan=annual"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example.test/sign-up?plan=annual");
  });

  it("carries a monthly plan through", async () => {
    const res = await GET(makeRequest("?plan=monthly"));
    expect(res.headers.get("location")).toBe("https://app.example.test/sign-up?plan=monthly");
  });

  it("defaults an unnamed plan to annual, the price the storefront shows", async () => {
    const res = await GET(makeRequest(""));
    expect(res.headers.get("location")).toBe("https://app.example.test/sign-up?plan=annual");
  });

  it("ignores an unrecognized plan rather than forwarding it", async () => {
    const res = await GET(makeRequest("?plan=lifetime"));
    expect(res.headers.get("location")).toBe("https://app.example.test/sign-up?plan=annual");
  });

  it("never caches — a cached redirect would funnel everyone the same way", async () => {
    const res = await GET(makeRequest("?plan=annual"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
