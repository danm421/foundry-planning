import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Apple universal links require this file to be served statically at
// /.well-known/apple-app-site-association (no extension, no redirect) so
// iOS can universal-link the Plaid OAuth bank redirect (/portal/oauth) back
// into the mobile app. See next.config.ts headers() for the Content-Type
// rule that makes this a valid application/json response in production.
describe("apple-app-site-association", () => {
  it("is valid JSON with an applinks block for /portal/oauth", () => {
    const raw = readFileSync(
      join(process.cwd(), "public/.well-known/apple-app-site-association"),
      "utf8",
    );
    const body = JSON.parse(raw);
    const detail = body.applinks.details[0];
    expect(detail.appIDs.length).toBeGreaterThan(0);
    expect(detail.components[0]["/"]).toBe("/portal/oauth*");
  });
});
