import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "../fonts";
import { AccentProvider, useAccent } from "../accent-context";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";

ensureFontsRegistered();

function Probe() {
  const a = useAccent();
  return <Text>{a.accent}</Text>;
}

describe("accent-context", () => {
  it("renders with a provided accent", async () => {
    const buf = await renderToBuffer(
      <Document>
        <Page>
          <AccentProvider accent={{ accent: "#123456", tint: "#abcdef" }}>
            <Probe />
          </AccentProvider>
        </Page>
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(0);
  });

  it("falls back to DEFAULT_ACCENT with no provider", async () => {
    const buf = await renderToBuffer(
      <Document><Page><Probe /></Page></Document>,
    );
    expect(buf.length).toBeGreaterThan(0);
    expect(DEFAULT_ACCENT.accent).toBe("#d97706");
  });
});
