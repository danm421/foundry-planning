// @vitest-environment jsdom
// src/components/import/__tests__/upload-zone.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import UploadZone from "../upload-zone";

const NAME = "hendricks-fact-finder.pdf";

function renderZone() {
  render(
    <UploadZone clientId="c1" importId="i1" initialFiles={[{ serverFileId: "f1", name: NAME, documentType: "auto" }]} />,
  );
}

// jsdom can't measure layout, so these pin the classes that do the work.
describe("a file's row", () => {
  it("keeps the file name readable in a narrow panel: the controls wrap under it instead of squeezing it away", () => {
    renderZone();
    const name = screen.getByText(NAME);
    expect(name).toHaveClass("min-w-[8rem]", "flex-1", "truncate");
    expect(name.parentElement).toHaveClass("flex-wrap");
    // The type, the status and remove move together, kept to the right.
    const controls = screen.getByRole("combobox").parentElement;
    expect(controls).toHaveClass("ml-auto");
    expect(controls).toContainElement(screen.getByText(/Uploaded/));
    expect(controls).toContainElement(screen.getByRole("button", { name: "Remove file" }));
  });

  it("draws remove in the theme's ink, so it shows in Light View too", () => {
    renderZone();
    const remove = screen.getByRole("button", { name: "Remove file" });
    expect(remove).toHaveClass("text-ink-3");
    expect(remove.className).not.toMatch(/text-white/);
  });
});
