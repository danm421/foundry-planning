// src/components/reports/widgets/divider.tsx
//
// Screen render for the divider widget — a single hairline rule used to
// split a page visually. Distinct from `components/reports/page-divider.tsx`,
// which is the builder-chrome control between pages; this is the user-
// addable widget that lives inside a page row.

export function DividerRender() {
  return <div className="border-t border-hair my-4" />;
}
