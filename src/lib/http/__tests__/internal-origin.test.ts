import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trustedInternalOrigin } from "@/lib/http/internal-origin";

// `vi.stubEnv` rather than direct assignment: NODE_ENV is typed readonly, and
// unstubAllEnvs restores whatever the runner set.
const APP_URL = "https://app.foundryplanning.com";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  vi.stubEnv("VERCEL_URL", undefined);
  vi.stubEnv("VERCEL_BRANCH_URL", undefined);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trustedInternalOrigin", () => {
  it("keeps the request origin when it matches the configured app URL", () => {
    expect(trustedInternalOrigin(`${APP_URL}/api/clients/1/x/export-pdf`)).toBe(APP_URL);
  });

  it("keeps a preview deployment's own origin", () => {
    vi.stubEnv("VERCEL_URL", "foundry-abc123.vercel.app");
    expect(trustedInternalOrigin("https://foundry-abc123.vercel.app/api/x")).toBe(
      "https://foundry-abc123.vercel.app",
    );
  });

  it("refuses a forged Host and falls back to the configured origin", () => {
    // This is the finding: `new URL(request.url).origin` is derived from the
    // incoming Host header, and the caller's session cookie rides along on the
    // self-fetch that used it.
    expect(trustedInternalOrigin("https://attacker.example/api/clients/1/x")).toBe(APP_URL);
  });

  it("does not accept a lookalike suffix of an allowed host", () => {
    expect(trustedInternalOrigin("https://evilapp.foundryplanning.com.attacker.test/x")).toBe(
      APP_URL,
    );
  });

  it("treats http and https as different origins", () => {
    expect(trustedInternalOrigin("http://app.foundryplanning.com/x")).toBe(APP_URL);
  });

  it("allows localhost outside production so `npm run dev` still exports", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(trustedInternalOrigin("http://localhost:3000/api/x")).toBe("http://localhost:3000");
  });

  it("refuses localhost in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(trustedInternalOrigin("http://localhost:3000/api/x")).toBe(APP_URL);
  });

  it("falls back on an unparseable request URL", () => {
    expect(trustedInternalOrigin("not a url")).toBe(APP_URL);
  });

  it("falls back to the production host when NEXT_PUBLIC_APP_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(trustedInternalOrigin("https://attacker.example/x")).toBe(APP_URL);
  });
});
