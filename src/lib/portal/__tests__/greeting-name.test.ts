import { describe, it, expect } from "vitest";
import { portalGreetingFullName, portalGreetingName } from "../greeting-name";

describe("portalGreetingName", () => {
  it("joins the primary and spouse first names", () => {
    expect(
      portalGreetingName([
        { role: "primary", firstName: "John", lastName: "Cooper" },
        { role: "spouse", firstName: "Jane", lastName: "Cooper" },
      ]),
    ).toBe("John & Jane");
  });

  it("names the primary first regardless of row order", () => {
    expect(
      portalGreetingName([
        { role: "spouse", firstName: "Jane", lastName: "Cooper" },
        { role: "primary", firstName: "John", lastName: "Cooper" },
      ]),
    ).toBe("John & Jane");
  });

  it("returns a single name for a one-person household", () => {
    expect(
      portalGreetingName([
        { role: "primary", firstName: "John", lastName: "Cooper" },
      ]),
    ).toBe("John");
  });

  it("prefers the preferred name over the legal first name", () => {
    expect(
      portalGreetingName([
        { role: "primary", firstName: "Katherine", preferredName: "Kate" },
        { role: "spouse", firstName: "Jonathan", preferredName: null },
      ]),
    ).toBe("Kate & Jonathan");
  });

  it("ignores a blank preferred name rather than greeting nobody", () => {
    expect(
      portalGreetingName([
        { role: "primary", firstName: "Katherine", preferredName: "   " },
      ]),
    ).toBe("Katherine");
  });

  it("greets only the primary and spouse — never children or other contacts", () => {
    expect(
      portalGreetingName([
        { role: "primary", firstName: "John" },
        { role: "child", firstName: "Milo" },
        { role: "other", firstName: "Pat" },
      ]),
    ).toBe("John");
  });

  it("returns an empty string when the household has no greetable contact", () => {
    expect(portalGreetingName([])).toBe("");
    expect(portalGreetingName([{ role: "child", firstName: "Milo" }])).toBe("");
  });

  it("drops a contact with no usable name instead of emitting a dangling '&'", () => {
    expect(
      portalGreetingName([
        { role: "primary", firstName: "John" },
        { role: "spouse", firstName: null },
      ]),
    ).toBe("John");
  });
});

describe("portalGreetingFullName", () => {
  it("names both halves of the household in full", () => {
    expect(
      portalGreetingFullName([
        { role: "primary", firstName: "John", lastName: "Cooper" },
        { role: "spouse", firstName: "Jane", lastName: "Whitfield" },
      ]),
    ).toBe("John Cooper & Jane Whitfield");
  });

  it("still prefers the preferred name over the legal first name", () => {
    expect(
      portalGreetingFullName([
        { role: "primary", firstName: "Katherine", lastName: "Cooper", preferredName: "Kate" },
      ]),
    ).toBe("Kate Cooper");
  });

  it("falls back to the first name alone when no surname is on file", () => {
    expect(
      portalGreetingFullName([
        { role: "primary", firstName: "John", lastName: null },
        { role: "spouse", firstName: "Jane", lastName: "Cooper" },
      ]),
    ).toBe("John & Jane Cooper");
  });

  it("drops a contact with no usable name instead of emitting a dangling '&'", () => {
    expect(
      portalGreetingFullName([
        { role: "primary", firstName: "John", lastName: "Cooper" },
        { role: "spouse", firstName: null, lastName: null },
      ]),
    ).toBe("John Cooper");
  });
});
