// Lightweight helper for testing @react-pdf trees: serialize JSX to a string
// so tests can assert on text / src without firing up the PDF binary pipeline.

import { renderToStaticMarkup } from "react-dom/server";

export function renderToTree(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}
