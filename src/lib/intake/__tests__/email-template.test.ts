import { describe, it, expect } from "vitest";
import {
  buildIntakeFromHeader,
  resolveSubject,
  buildIntakeEmailHtml,
} from "@/lib/intake/email-template";
import { DEFAULT_INTAKE_SUBJECT } from "@/lib/intake/defaults";

describe("buildIntakeFromHeader", () => {
  it("uses fromName when set", () => {
    expect(buildIntakeFromHeader("Acme Wealth", "Acme LLC")).toBe(
      '"Acme Wealth" <noreply@foundryplanning.com>',
    );
  });
  it("falls back to firmName, then to Foundry", () => {
    expect(buildIntakeFromHeader(undefined, "Acme LLC")).toBe(
      '"Acme LLC" <noreply@foundryplanning.com>',
    );
    expect(buildIntakeFromHeader()).toBe('"Foundry" <noreply@foundryplanning.com>');
  });
  it("strips CR/LF (header-injection guard) and quotes specials", () => {
    expect(buildIntakeFromHeader("Acme,\r\nEvil")).toBe(
      '"Acme, Evil" <noreply@foundryplanning.com>',
    );
    expect(buildIntakeFromHeader('A"B')).toBe('"A\\"B" <noreply@foundryplanning.com>');
  });
  it("preserves legitimate punctuation in the display name (hyphen, ampersand, parens)", () => {
    expect(buildIntakeFromHeader("Smith-Jones & Co (Advisors)")).toBe(
      '"Smith-Jones & Co (Advisors)" <noreply@foundryplanning.com>',
    );
  });
});

describe("resolveSubject", () => {
  it("returns the default when unset", () => {
    expect(resolveSubject()).toBe(DEFAULT_INTAKE_SUBJECT);
    expect(resolveSubject("")).toBe(DEFAULT_INTAKE_SUBJECT);
  });
  it("returns the custom subject when set", () => {
    expect(resolveSubject("Time to get started")).toBe("Time to get started");
  });
});

describe("buildIntakeEmailHtml", () => {
  const base = {
    link: "https://app.foundryplanning.com/intake/tok",
    advisorName: "Jane Advisor",
    advisorEmail: "jane@acme.com",
    firmName: "Acme Wealth",
    clientName: "Sam Client",
  };

  it("substitutes merge tokens in the intro", () => {
    const html = buildIntakeEmailHtml({ ...base, introBody: "Hi from {{advisorName}} at {{firmName}}, {{clientName}}." });
    expect(html).toContain("Hi from Jane Advisor at Acme Wealth, Sam Client.");
  });

  it("uses the default intro when introBody is empty", () => {
    const html = buildIntakeEmailHtml({ ...base, introBody: "" });
    // default intro leads with {{advisorName}} → resolved
    expect(html).toContain("Jane Advisor has shared a secure form");
  });

  it("HTML-escapes advisor-supplied text and token values (no injection)", () => {
    const html = buildIntakeEmailHtml({
      ...base,
      advisorName: "<script>x</script>",
      introBody: "Body with <b>raw</b> and {{advisorName}}",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
  });

  it("leaves unknown tokens as literal text", () => {
    const html = buildIntakeEmailHtml({ ...base, introBody: "Hello {{nope}}" });
    expect(html).toContain("Hello {{nope}}");
  });

  it("renders the greeting from clientName, falling back to a bare hello", () => {
    expect(buildIntakeEmailHtml({ ...base }).toLowerCase()).toContain("hello sam client");
    expect(buildIntakeEmailHtml({ ...base, clientName: undefined }).toLowerCase()).toContain("hello,");
  });

  it("renders an auto-composed signature: name, firm, mailto email", () => {
    const html = buildIntakeEmailHtml({ ...base, introBody: "x" });
    expect(html).toContain("Jane Advisor");
    expect(html).toContain("Acme Wealth");
    expect(html).toContain('href="mailto:jane@acme.com"');
  });

  it("omits signature lines that have no value", () => {
    const html = buildIntakeEmailHtml({
      link: base.link,
      introBody: "x",
      advisorName: "Jane Advisor",
    });
    expect(html).not.toContain("mailto:");
  });
  it("preserves paragraph breaks in a multi-paragraph intro", () => {
    const html = buildIntakeEmailHtml({ ...base, introBody: "First paragraph.\n\nSecond paragraph." });
    expect(html).toContain("<p>First paragraph.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });

  it("renders a single newline within a paragraph as a line break", () => {
    const html = buildIntakeEmailHtml({ ...base, introBody: "Line one.\nLine two." });
    expect(html).toContain("Line one.<br/>Line two.");
  });
});
