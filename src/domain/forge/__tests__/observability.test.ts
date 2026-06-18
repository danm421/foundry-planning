import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { maybeLangfuseHandler, flushLangfuse } from "../observability";
import type { ForgeAuthContext } from "../state";

const ctx: ForgeAuthContext = {
  userId: "user_1",
  firmId: "org_1",
  clientId: "client_1",
  scenarioId: "base",
};

describe("maybeLangfuseHandler", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.FORGE_LANGFUSE_ENABLED;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASEURL;
    delete process.env.LANGFUSE_BASE_URL;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns null when the flag is off", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    process.env.LANGFUSE_BASEURL = "https://cloud.langfuse.com";
    expect(maybeLangfuseHandler(ctx, "conv_1")).toBeNull();
  });

  it("returns null when the flag is on but keys are missing", () => {
    process.env.FORGE_LANGFUSE_ENABLED = "true";
    expect(maybeLangfuseHandler(ctx, "conv_1")).toBeNull();
  });

  it("returns a handler when enabled and fully configured", () => {
    process.env.FORGE_LANGFUSE_ENABLED = "true";
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    process.env.LANGFUSE_BASEURL = "https://cloud.langfuse.com";
    expect(maybeLangfuseHandler(ctx, "conv_1")).not.toBeNull();
  });

  it("flushLangfuse(null) resolves without throwing", async () => {
    await expect(flushLangfuse(null)).resolves.toBeUndefined();
  });
});
