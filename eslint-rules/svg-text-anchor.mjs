// Flat-config ESLint rule: every label a react-pdf chart draws must say which
// way it runs.
//
// This defect has been found by hand in five chart families across three
// sessions, and it is invisible to every other instrument in the repo — tsc and
// eslint see well-formed JSX, the render smokes assert a byte length, and the
// spec tests assert tick VALUES, not where a glyph landed. Only a rendered
// sheet ever caught one. Three shapes, all of them here:
//
//   1. `<SvgText x={...}>` with no `textAnchor`. SVG's default is `start`, so a
//      y-axis tick drawn at `x={-6}` begins 6pt left of the plot and runs
//      rightward THROUGH it, and an x-axis tick drawn AT a bar's centre puts
//      its own centre most of a step past the bar it names. The second kind is
//      the worse one: nothing looks broken, the chart just names the wrong bar.
//      ⚠️ `textAnchor` also INHERITS down the SVG tree (@react-pdf/layout's
//      BASE_SVG_INHERITED_PROPS), so an unanchored label's alignment can come
//      from an ancestor `<G>` off-screen in the file. Saying it out loud is the
//      only way to read a chart's alignment locally.
//   2. `textAnchor` inside the `style` object. It WORKS — @react-pdf picks it up
//      through the same inheritance — but it hides an alignment decision among
//      font and fill, where review does not look for one.
//   3. `textAlign` inside the `style` object. Inert: @react-pdf/render's
//      `renderSpan` switches on `textAnchor` and never reads `textAlign`, so
//      this is a centring that silently does nothing. It shipped on a live
//      chart, whose year labels landed 0.82 of a band off the bar they named.
//
// A shared `<AxisLabel>` component was considered and rejected: across ~46 call
// sites the font, size, fill and `scale` all differ, so it would take six props
// to say one word. The rule is the right shape.
//
// Scope: elements bound to `@react-pdf/renderer`'s `Text` under an ALIAS — the
// repo's convention is `Text as SvgText`, and the alias is the author saying
// "this is SVG text". Aliasing is therefore also the way to bypass the rule, so
// a plain `<Text>` rendered inside an `<Svg>` is reported too, asking for the
// alias.
//
// Not covered, deliberately: a `style` held in a variable rather than written
// inline (there are none), and an `x` arriving through a spread (there are
// none). Both are visible to `grep` if that changes.

/** Every property name written in an object literal anywhere under `node`.
 *  One walk, because `style` is read for two keys — and a subtree rather than
 *  the top-level object so a spread (`{ ...base, textAlign }`) or a conditional
 *  (`cond ? {...} : {...}`) is seen too. `seen` guards the `parent`
 *  back-references ESLint hangs off every node. */
function styleKeys(node, found = new Set(), seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return found;
  seen.add(node);
  if (node.type === "Property" && !node.computed) {
    found.add(node.key?.name ?? node.key?.value);
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "parent" || !v || typeof v !== "object") continue;
    styleKeys(v, found, seen);
  }
  return found;
}

function attr(openingElement, name) {
  return openingElement.attributes.find(
    (a) => a.type === "JSXAttribute" && a.name?.type === "JSXIdentifier" && a.name.name === name,
  );
}

/** Is `node` rendered inside a `<tag>` element? */
function isInside(node, tag) {
  for (let p = node.parent; p; p = p.parent) {
    if (
      p.type === "JSXElement"
      && p.openingElement.name.type === "JSXIdentifier"
      && p.openingElement.name.name === tag
    ) return true;
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an explicit textAnchor on positioned react-pdf SVG text, and keep alignment out of its style object.",
    },
    schema: [],
    messages: {
      missingAnchor:
        "<{{name}}> is placed at an `x` but never says which way it runs. SVG's default is `start`, which is what makes an axis label print across the plot or name the wrong bar — and `textAnchor` inherits from ancestors, so the alignment may not even be in this component. Add textAnchor=\"start\" | \"middle\" | \"end\".",
      anchorInStyle:
        "`textAnchor` belongs on <{{name}}> as a prop, not inside `style`. It works there, but it hides the one alignment decision this element makes among font and fill, which is where four reviews missed it.",
      textAlignInert:
        "`textAlign` does nothing on <{{name}}>. @react-pdf's SVG text renderer reads `textAnchor` only, so this is a centring that silently never happens — it shipped once and put year labels 0.82 of a band off the bar they named. Use textAnchor=\"middle\".",
      unaliasedSvgText:
        "<{{name}}> inside <{{svg}}> is SVG text, but it is imported unaliased, so the anchor rule cannot see it. Import it as `Text as SvgText`, the convention every other chart uses.",
    },
  },
  create(context) {
    /** Local names bound to react-pdf's `Text` under an alias. */
    const aliased = new Set();
    /** Does the file import react-pdf's `Text` unaliased? */
    let importsPlainText = false;
    /** Local name of react-pdf's `Svg`. */
    let svgName = null;

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@react-pdf/renderer") return;
        for (const s of node.specifiers) {
          if (s.type !== "ImportSpecifier") continue;
          if (s.imported.name === "Text") {
            if (s.local.name === "Text") importsPlainText = true;
            else aliased.add(s.local.name);
          }
          if (s.imported.name === "Svg") svgName = s.local.name;
        }
      },

      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const name = node.name.name;

        if (aliased.has(name)) {
          const style = attr(node, "style");
          const styled = style ? styleKeys(style.value) : new Set();

          // No anchor at all. An in-style one does not count as missing — it
          // works, and `anchorInStyle` below already says to move it — but an
          // in-style `textAlign` DOES, because it is inert.
          if (attr(node, "x") && !attr(node, "textAnchor") && !styled.has("textAnchor")) {
            context.report({ node, messageId: "missingAnchor", data: { name } });
          }
          if (styled.has("textAlign")) {
            context.report({ node: style, messageId: "textAlignInert", data: { name } });
          }
          if (styled.has("textAnchor")) {
            context.report({ node: style, messageId: "anchorInStyle", data: { name } });
          }
          return;
        }

        // The bypass: react-pdf's `Text` is the SAME component inside and
        // outside an `<Svg>`, so an unaliased one under an `<Svg>` is SVG text
        // that the check above cannot recognise.
        if (svgName && importsPlainText && name === "Text" && isInside(node, svgName)) {
          context.report({ node, messageId: "unaliasedSvgText", data: { name, svg: svgName } });
        }
      },
    };
  },
};

export default rule;
