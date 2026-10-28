import { afterEach, describe, expect, it } from "vitest";
import { isWorkspaceEnabled } from "./flag";

const original = process.env.WORKSPACE_ENABLED;
afterEach(() => {
  process.env.WORKSPACE_ENABLED = original;
});

describe("isWorkspaceEnabled", () => {
  it("is false when unset", () => {
    delete process.env.WORKSPACE_ENABLED;
    expect(isWorkspaceEnabled()).toBe(false);
  });

  it.each(["1", "yes", "TRUE", ""])("is false for %s (strict equality)", (v) => {
    process.env.WORKSPACE_ENABLED = v;
    expect(isWorkspaceEnabled()).toBe(false);
  });

  it("is true only for the exact string true", () => {
    process.env.WORKSPACE_ENABLED = "true";
    expect(isWorkspaceEnabled()).toBe(true);
  });
});
