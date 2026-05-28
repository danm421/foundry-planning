import { describe, it, expectTypeOf } from "vitest";
import type { PresentationPageDescriptor } from "../types";

describe("PresentationPageDescriptor", () => {
  it("requires options (not optional)", () => {
    // PresentationPageDescriptor must extend { options: unknown } (required).
    // If options were optional, PresentationPageDescriptor would NOT extend the
    // required shape and this assertion would fail — catching the regression.
    expectTypeOf<PresentationPageDescriptor>().toMatchTypeOf<{
      pageId: string;
      options: unknown;
    }>();
  });
});
