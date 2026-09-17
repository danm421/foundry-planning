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
    // Each paragraph lands in its own styled <p> — assert the split, not the
    // presentation, so a restyle of the shell doesn't read as a regression.
    expect(html).toContain(">First paragraph.</p>");
    expect(html).toContain(">Second paragraph.</p>");
  });

  it("renders a single newline within a paragraph as a line break", () => {
    const html = buildIntakeEmailHtml({ ...base, introBody: "Line one.\nLine two." });
    expect(html).toContain("Line one.<br/>Line two.");
  });

  // This HTML is rendered through dangerouslySetInnerHTML in the advisor-
  // facing preview (components/intake/admin/email-settings-editor.tsx), so a
  // value that escapes its attribute executes in an advisor's browser, not
  // just in a mail client. Escaping `<`/`>` alone does not stop that — the
  // signature interpolates into a double-quoted href.
  it("escapes quotes so a value cannot break out of an attribute", () => {
    const html = buildIntakeEmailHtml({
      ...base,
      advisorEmail: 'x@y.test" onmouseover="alert(1)',
    });
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("escapes quotes in text-context values too", () => {
    const html = buildIntakeEmailHtml({
      ...base,
      clientName: 'Sam "The Closer" Client',
      introBody: "hi",
    });
    expect(html).toContain("Sam &quot;The Closer&quot; Client");
  });

  it("does not double-escape an ampersand", () => {
    const html = buildIntakeEmailHtml({ ...base, firmName: "Ampersand & Co" });
    expect(html).toContain("Ampersand &amp; Co");
    expect(html).not.toContain("&amp;amp;");
  });

  it("keeps the intake button label when no override is given", () => {
    expect(buildIntakeEmailHtml(base)).toContain("Open My Form");
  });

  it("lets another sender on this shell name its own button", () => {
    const html = buildIntakeEmailHtml({ ...base, ctaLabel: "Sign in to my portal" });
    expect(html).toContain("Sign in to my portal");
    expect(html).not.toContain("Open My Form");
  });

  it("escapes a button label so it cannot break out of the anchor", () => {
    const html = buildIntakeEmailHtml({ ...base, ctaLabel: '"><script>x</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  // The shell is a full document on purpose: a mail client only reads the
  // colour-scheme hints from the head, and the advisor preview feeds the
  // return value straight into an iframe srcDoc with no wrapper of its own
  // (components/intake/admin/email-settings-editor.tsx).
  it("returns a complete document with the head-level colour-scheme hints", () => {
    const html = buildIntakeEmailHtml(base);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="light"/>');
    expect(html).toContain('<meta name="supported-color-schemes" content="light"/>');
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  // Outlook's Word renderer drops max-width and CSS background on a <div>, so
  // the centred card depends on a table shell carrying bgcolor attributes.
  // Easy to "simplify" back into divs later, which is why it's pinned.
  it("lays the shell out as tables with bgcolor, not divs", () => {
    const html = buildIntakeEmailHtml(base);
    expect(html).toContain('<table role="presentation"');
    // Page canvas and card each paint via attribute, not CSS alone.
    expect(html).toMatch(/<table[^>]*bgcolor="#f3f1ea"/);
    expect(html).toMatch(/<table[^>]*bgcolor="#ffffff"/);
    // The CTA is a table-wrapped cell so Outlook paints the button rectangle.
    expect(html).toMatch(/<td bgcolor="#1a1d27"[^>]*>\s*<a href=/);
  });

  it("attributes the send to the firm, and says the link is personal", () => {
    const html = buildIntakeEmailHtml(base);
    expect(html).toContain("Sent by Acme Wealth through Foundry Planning.");
    expect(html).toContain("This link is personal to you");
  });

  // Without the unbranded branch this reads "Sent by Foundry Planning through
  // Foundry Planning" — the firm name falls back to the Foundry default.
  it("drops the 'Sent by' clause when no firm name resolved", () => {
    const html = buildIntakeEmailHtml({ link: base.link, clientName: "Sam Client" });
    expect(html).toContain("Sent through Foundry Planning.");
    expect(html).not.toContain("Sent by");
  });

  it("escapes the firm name in the attribution line", () => {
    const html = buildIntakeEmailHtml({ ...base, firmName: 'Acme " <b>Co</b>' });
    expect(html).toContain("Sent by Acme &quot; &lt;b&gt;Co&lt;/b&gt; through Foundry Planning.");
  });
});
