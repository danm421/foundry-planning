import { describe, it, expect, vi, beforeEach } from "vitest";

const setMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setMock }),
}));

import { dismissBanner } from "../subscription-banner-actions";

describe("dismissBanner", () => {
  beforeEach(() => setMock.mockClear());

  it("sets the cookie for a valid key", async () => {
    await dismissBanner("trial_ending:2026-05-30");
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it("ignores an over-long key without setting a cookie", async () => {
    await dismissBanner("x".repeat(200));
    expect(setMock).not.toHaveBeenCalled();
  });
});
