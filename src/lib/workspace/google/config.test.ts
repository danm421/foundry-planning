// src/lib/workspace/google/config.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { GOOGLE_SCOPES, GOOGLE_USER_REDIRECT_PATH, googleAppConfig, isGoogleConfigured } from "./config";

describe("google config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["the client id", "", "csecret"],
    ["the client secret", "cid", ""],
    ["both", "", ""],
  ])("isGoogleConfigured is false with %s empty", (_label, id, secret) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", id);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", secret);
    expect(isGoogleConfigured()).toBe(false);
  });

  it("isGoogleConfigured is true with both set", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "csecret");
    expect(isGoogleConfigured()).toBe(true);
  });

  it("asks for exactly sign-in, calendar events and tasks: nothing restricted", () => {
    expect(GOOGLE_SCOPES).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/tasks",
    ]);
  });

  it("the redirect path is the Google callback route", () => {
    expect(GOOGLE_USER_REDIRECT_PATH).toBe("/api/workspace/google/callback");
  });

  it("googleAppConfig reads the client and app URL, and names a missing env var", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "csecret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    expect(googleAppConfig()).toEqual({ clientId: "cid", clientSecret: "csecret", appUrl: "https://app.test" });

    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(() => googleAppConfig()).toThrow("GOOGLE_CLIENT_SECRET is not set");
  });
});
