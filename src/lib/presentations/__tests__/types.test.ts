import { describe, it, expectTypeOf } from "vitest";
import type { PresentationPageDescriptor } from "../types";

describe("PresentationPageDescriptor", () => {
  it("requires options (not optional)", () => {
    // options must be required: { pageId: string; options: unknown } must be
    // assignable TO PresentationPageDescriptor (i.e. PresentationPageDescriptor
    // must not have options as optional).
    expectTypeOf<{ pageId: string; options: unknown }>().toMatchTypeOf<PresentationPageDescriptor>();
  });
});
