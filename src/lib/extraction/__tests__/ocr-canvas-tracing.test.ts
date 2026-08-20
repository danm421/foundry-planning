/**
 * Every route handler that can reach `vision-ocr.ts` needs @napi-rs/canvas
 * traced into its deployed bundle. Nothing else can discover that dependency:
 * `serverExternalPackages` keeps it out of the chunk and the dynamic import
 * carries turbopackIgnore, so the trace is the only thing putting the package
 * in /var/task. When it was missing, prod answered every scanned-PDF upload
 * with "it appears to be a scanned image we couldn't process" — the file was
 * fine; the reader was absent.
 *
 * This walks the import graph rather than pinning a hand-written route list,
 * so wiring OCR into a new route fails here instead of in production.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { OCR_CANVAS_FILES, outputFileTracingIncludes } from "../../../../next.tracing";

const ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.join(ROOT, "src");
const OCR_MODULE = path.join(SRC, "lib/extraction/vision-ocr.ts");

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const EXTS = [".ts", ".tsx"];

/** Resolve a `@/…` or relative specifier to a file on disk; null for bare packages. */
function resolveSpec(spec: string, fromFile: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
    else return null;

    for (const ext of ["", ...EXTS]) {
        const candidate = base + ext;
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    for (const ext of EXTS) {
        const candidate = path.join(base, `index${ext}`);
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

/** Route handlers whose module graph contains `vision-ocr.ts`, as route paths. */
function routesReachingOcr(): string[] {
    const files = readdirSync(SRC, { recursive: true, encoding: "utf-8" })
        .filter((p) => /\.tsx?$/.test(p) && !p.includes("__tests__") && !/\.test\.tsx?$/.test(p))
        .map((p) => path.join(SRC, p));

    // imported file → files importing it
    const importers = new Map<string, Set<string>>();
    for (const file of files) {
        for (const [, spec] of readFileSync(file, "utf-8").matchAll(IMPORT_RE)) {
            const target = resolveSpec(spec, file);
            if (!target) continue;
            if (!importers.has(target)) importers.set(target, new Set());
            importers.get(target)!.add(file);
        }
    }

    const reached = new Set([OCR_MODULE]);
    const queue = [OCR_MODULE];
    while (queue.length) {
        for (const importer of importers.get(queue.shift()!) ?? []) {
            if (reached.has(importer)) continue;
            reached.add(importer);
            queue.push(importer);
        }
    }

    return [...reached]
        .filter((file) => file.startsWith(path.join(SRC, "app")) && file.endsWith("/route.ts"))
        .map((file) =>
            // src/app/(app)/api/x/[id]/route.ts → /api/x/[id]
            `/${path
                .relative(path.join(SRC, "app"), path.dirname(file))
                .replace(/\([^)]+\)\//g, "")}`,
        )
        .sort();
}

/** picomatch-style route key: `*` spans one segment (it stands in for `[id]`). */
function keyMatches(key: string, route: string): boolean {
    const pattern = key
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]+");
    return new RegExp(`^${pattern}$`).test(route);
}

function tracedFilesFor(route: string): string[] {
    return Object.entries(outputFileTracingIncludes)
        .filter(([key]) => keyMatches(key, route))
        .flatMap(([, files]) => files);
}

describe("output file tracing covers the vision-OCR routes", () => {
    const routes = routesReachingOcr();

    it("finds the route handlers that can rasterize a PDF page", () => {
        // A zero-length walk would make every assertion below vacuously pass.
        expect(routes).toContain("/api/clients/[id]/imports/[importId]/extract");
    });

    it.each(routes)("%s traces @napi-rs/canvas", (route) => {
        const traced = tracedFilesFor(route);
        for (const file of OCR_CANVAS_FILES) expect(traced).toContain(file);
    });
});
