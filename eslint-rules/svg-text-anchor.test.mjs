import { RuleTester } from "eslint";
import rule from "./svg-text-anchor.mjs";

const rt = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const imp = 'import { Svg, G, Text as SvgText } from "@react-pdf/renderer";\n';
const plainImp = 'import { Svg, Text } from "@react-pdf/renderer";\n';

rt.run("svg-text-anchor", rule, {
  valid: [
    // The three shapes the charts actually use.
    { code: imp + 'const a = <SvgText x={-6} textAnchor="end" style={{ fontSize: 7 }}>$1.2M</SvgText>;' },
    { code: imp + "const a = <SvgText x={cx} textAnchor={i === 0 ? \"start\" : \"middle\"}>2026</SvgText>;" },
    { code: imp + 'const a = <SvgText x={0} textAnchor="start">$0</SvgText>;' },
    // No `x` — nothing to anchor against. This is the need chart's em-dash
    // empty state, which is not inside an <Svg> at all.
    { code: imp + "const a = <SvgText style={{ fontSize: 8 }}>—</SvgText>;" },
    // `textAlign` on a FLOW <Text> is legitimate and must not be flagged.
    { code: plainImp + 'const a = <Text style={{ textAlign: "center" }}>Title</Text>;' },
    // ...including one that merely sits in the same file as an <Svg>.
    { code: plainImp + 'const a = <><Svg><Rect /></Svg><Text style={{ textAlign: "center" }}>Title</Text></>;' },
    // Not a react-pdf import.
    { code: 'import { Text as SvgText } from "somewhere-else";\nconst a = <SvgText x={4}>hi</SvgText>;' },
  ],
  invalid: [
    // 1. Positioned with no anchor.
    { code: imp + "const a = <SvgText x={-6} y={4}>$1.2M</SvgText>;", errors: [{ messageId: "missingAnchor" }] },
    { code: imp + "const a = <SvgText x={cx + 2} y={8}>{mk.label}</SvgText>;", errors: [{ messageId: "missingAnchor" }] },
    // 2. Alignment hidden in `style`.
    {
      code: imp + 'const a = <SvgText x={4} style={{ fontSize: 7, textAnchor: "middle" }}>2026</SvgText>;',
      errors: [{ messageId: "anchorInStyle" }],
    },
    // 3. The inert one.
    {
      code: imp + 'const a = <SvgText x={4} textAnchor="middle" style={{ textAlign: "center" }}>2026</SvgText>;',
      errors: [{ messageId: "textAlignInert" }],
    },
    // Inert AND unanchored — the shape the life-insurance need chart shipped.
    {
      code: imp + 'const a = <SvgText x={4} style={{ textAlign: "center" }}>2026</SvgText>;',
      // Reported in source order: the element opens before its `style`.
      errors: [{ messageId: "missingAnchor" }, { messageId: "textAlignInert" }],
    },
    // Found through a spread and through a conditional, not just a bare literal.
    {
      code: imp + 'const a = <SvgText x={4} style={{ ...base, textAlign: "center" }} textAnchor="middle" />;',
      errors: [{ messageId: "textAlignInert" }],
    },
    {
      code: imp + 'const a = <SvgText x={4} style={hi ? { textAnchor: "end" } : { fontSize: 7 }} />;',
      // One mistake, one error: an in-style anchor WORKS, so it is not also "missing".
      errors: [{ messageId: "anchorInStyle" }],
    },
    // 4. The bypass: unaliased SVG text, nested any depth under <Svg>.
    {
      code: plainImp + "const a = <Svg><G>{ticks.map((t) => <Text x={4}>{t}</Text>)}</G></Svg>;",
      errors: [{ messageId: "unaliasedSvgText" }],
    },
  ],
});
