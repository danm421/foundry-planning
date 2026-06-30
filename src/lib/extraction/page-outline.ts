/**
 * Build a compact, per-page outline of a multi-page document for the
 * fact-finder section classifier.
 *
 * The classifier decides which page ranges hold which entity types (family,
 * income, expenses, …) and then runs a focused prompt on only those pages.
 * Previously it was handed an empty outline plus a truncated anchor set (the
 * first three pages + the last page), so for any document longer than four
 * pages it was BLIND to the middle pages — income/expenses/insurance that lived
 * there were never classified and never extracted.
 *
 * This produces one `Page N: <heading>` line per page so the classifier can see
 * the whole document at a glance. Repeated header/footer/disclaimer lines
 * (which carry no per-page signal) are stripped first: any line that — after
 * collapsing whitespace and replacing digit runs with `#` — appears on at least
 * half the pages is treated as boilerplate. The digit normalization is what
 * lets a footer like "Version 1.1.1491.1739 … Page 1 of 9" be recognized as the
 * same boilerplate as "Version 10.3.1094.16115 … Page 7 of 9". Boilerplate
 * detection only kicks in at 3+ pages, where a repeated line is meaningful.
 */
export function buildPageOutline(
    pages: string[],
    opts?: { linesPerPage?: number; maxLineLen?: number },
): string {
    if (pages.length === 0) return "";

    const linesPerPage = opts?.linesPerPage ?? 3;
    const maxLineLen = opts?.maxLineLen ?? 160;

    const normalize = (line: string): string =>
        line.trim().replace(/\s+/g, " ").replace(/\d+/g, "#").toLowerCase();

    // Count, per normalized line, how many pages it appears on (deduped within
    // a page so a line repeated on one page doesn't inflate the count).
    const pagesContainingLine = new Map<string, number>();
    for (const page of pages) {
        const seenOnPage = new Set<string>();
        for (const raw of page.split(/\r?\n/)) {
            const norm = normalize(raw);
            if (norm.length < 4 || seenOnPage.has(norm)) continue;
            seenOnPage.add(norm);
            pagesContainingLine.set(norm, (pagesContainingLine.get(norm) ?? 0) + 1);
        }
    }

    const boilerplateThreshold = Math.ceil(pages.length / 2);
    const isBoilerplate = (line: string): boolean =>
        pages.length >= 3 &&
        (pagesContainingLine.get(normalize(line)) ?? 0) >= boilerplateThreshold;

    const entries = pages.map((page, idx) => {
        const kept: string[] = [];
        for (const raw of page.split(/\r?\n/)) {
            const line = raw.trim().replace(/\s+/g, " ");
            if (line.length < 2 || isBoilerplate(line)) continue;
            kept.push(line.length > maxLineLen ? line.slice(0, maxLineLen) : line);
            if (kept.length >= linesPerPage) break;
        }
        const heading = kept.join(" · ") || "(no distinct content)";
        return `Page ${idx + 1}: ${heading}`;
    });

    return entries.join("\n");
}
