import { afterEach, describe, expect, it } from "vitest";
import { plaidWebhookUrl } from "../webhook-url";

const ENV_KEYS = ["PLAID_WEBHOOK_URL", "VERCEL_ENV", "NEXT_PUBLIC_APP_URL"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("plaidWebhookUrl", () => {
  it("override env var wins everywhere", () => {
    process.env.PLAID_WEBHOOK_URL = "https://preview.example.com/api/webhooks/plaid";
    process.env.VERCEL_ENV = "preview";
    expect(plaidWebhookUrl()).toBe("https://preview.example.com/api/webhooks/plaid");
  });
  it("production derives from app URL", () => {
    delete process.env.PLAID_WEBHOOK_URL;
    process.env.VERCEL_ENV = "production";
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(plaidWebhookUrl()).toBe("https://app.foundryplanning.com/api/webhooks/plaid");
  });
  it("non-production without override returns undefined", () => {
    delete process.env.PLAID_WEBHOOK_URL;
    process.env.VERCEL_ENV = "preview";
    expect(plaidWebhookUrl()).toBeUndefined();
    delete process.env.VERCEL_ENV;
    expect(plaidWebhookUrl()).toBeUndefined();
  });
});
