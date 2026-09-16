// Flat-config ESLint rule: ban Tailwind's DEFAULT palette in source.
//
// `text-gray-300` is theme-blind — it renders the same pixels under dark,
// light and industrial. The app ships three themes, so a default-palette
// class is wrong in at least two of them; on the light ramp `text-gray-300`
// measures about 1.3:1 and simply is not there. An advisor reported exactly
// that before the 2026-09-16 sweep.
//
// Sibling to `brand/no-raw-hex`, whose job is stopping drift OUT of the token
// system. This closes the other half of the same door: drift back INTO the
// framework default.

const PALETTE = "(gray|slate|zinc|neutral|stone)";
const PREFIX =
  "(bg|text|border|ring|divide|placeholder|from|to|via|decoration|outline|shadow|accent|caret|fill|stroke)";
const PATTERN = new RegExp(`\\b${PREFIX}-${PALETTE}-\\d{2,3}\\b`, "g");

// Nearest token for each Tailwind tone, so the message is actionable rather
// than just prohibitive. The surface tones are deliberately conservative:
// `700` is a hairline more often than a fill in this codebase.
const SUGGESTIONS = {
  50: "text-ink",
  100: "text-ink",
  200: "text-ink-2",
  300: "text-ink-3",
  400: "text-ink-3",
  500: "text-ink-4",
  600: "text-ink-4 / border-hair-2",
  700: "border-hair / bg-card-hover",
  800: "bg-card-2 / border-hair",
  900: "bg-card-2",
  950: "bg-card-2",
};

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Tailwind's default colour palette; use the theme tokens so all three themes work.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      defaultPalette:
        "'{{cls}}' is theme-blind — it renders identically under dark, light and industrial. Use a token (try {{hint}}); see src/app/globals.css.",
    },
  },
  create(context) {
    const allow = new Set(context.options?.[0]?.allow ?? []);

    function check(node, text) {
      if (typeof text !== "string") return;
      for (const m of text.matchAll(PATTERN)) {
        const cls = m[0];
        if (allow.has(cls)) continue;
        const tone = cls.match(/-(\d{2,3})$/)?.[1];
        context.report({
          node,
          messageId: "defaultPalette",
          data: { cls, hint: SUGGESTIONS[tone] ?? "a theme token" },
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value?.raw);
      },
    };
  },
};

export default rule;
