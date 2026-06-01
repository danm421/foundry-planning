// Flat-config ESLint rule: ban raw hex colors in source so the brand token
// system can't silently drift back. Use token classes (`bg-card`, `text-ink-2`,
// `border-hair`), `var(--color-*)`, the `@/brand` JS tokens, or `useChartColors()`
// for charts. Legitimate print/PDF hex (PDF_THEME) lives in `**/tokens.ts`
// (ignored at the config level) or can be allow-listed per file.

const HEX_GLOBAL = /#[0-9a-fA-F]{3,8}\b/g;

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw hex colors in source; use brand tokens / var(--color-*) / token classes.",
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
      rawHex:
        "Raw hex color '{{hex}}' — use a brand token (e.g. text-ink-2, bg-card, border-hair, var(--color-*)) instead. Charts: useChartColors(). Allow-list only legitimate print/PDF hex.",
    },
  },
  create(context) {
    const allow = new Set(context.options?.[0]?.allow ?? []);

    function check(node, text) {
      if (typeof text !== "string") return;
      const matches = text.match(HEX_GLOBAL);
      if (!matches) return;
      for (const hex of matches) {
        if (allow.has(hex)) continue;
        context.report({ node, messageId: "rawHex", data: { hex } });
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
