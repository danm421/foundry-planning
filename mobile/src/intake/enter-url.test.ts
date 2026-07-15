import { describe, it, expect } from "vitest";
import { buildIntakeEnterUrl } from "./enter-url";

describe("buildIntakeEnterUrl", () => {
  it("appends the ticket as an encoded query param", () => {
    expect(buildIntakeEnterUrl("https://app.foundryplanning.com", "sit_abc")).toBe(
      "https://app.foundryplanning.com/intake/enter?ticket=sit_abc",
    );
  });

  it("url-encodes tickets with special characters", () => {
    expect(buildIntakeEnterUrl("https://x.test", "a b/c+d")).toBe(
      "https://x.test/intake/enter?ticket=a%20b%2Fc%2Bd",
    );
  });
});
