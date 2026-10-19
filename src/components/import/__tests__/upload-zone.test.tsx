// @vitest-environment jsdom
// src/components/import/__tests__/upload-zone.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";
import UploadZone from "../upload-zone";

const NAME = "hendricks-fact-finder.pdf";

function renderZone(props: Partial<Parameters<typeof UploadZone>[0]> = {}) {
  render(
    <UploadZone clientId="c1" importId="i1" initialFiles={[{ serverFileId: "f1", name: NAME, documentType: "auto" }]} {...props} />,
  );
}

afterEach(() => vi.unstubAllGlobals());

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

describe("removing and retyping a file the server holds", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("keeps a file the server refused to remove, with the server's reason, and tells no one it went", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: SAVE_CLOSED_MESSAGE })));
    const onRemoved = vi.fn();
    renderZone({ onRemoved });
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(await screen.findByText(SAVE_CLOSED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("drops the row and reports it once the server lets the file go", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const onRemoved = vi.fn();
    renderZone({ onRemoved });
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("f1"));
    expect(screen.queryByText(NAME)).toBeNull();
  });

  it("puts back a document type the server refused, and says why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: SAVE_CLOSED_MESSAGE })));
    renderZone();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "account_statement" } });
    expect(await screen.findByText(SAVE_CLOSED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("auto");
  });

  it("draws no type picker when asked not to", () => {
    renderZone({ typePicker: false });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
  });
});

describe("the drop zone", () => {
  it("is a button the keyboard can reach: Enter and Space open the file picker", () => {
    renderZone();
    const zone = screen.getByRole("button", { name: /Drag & drop files here/ });
    expect(zone).toHaveAttribute("tabIndex", "0");
    expect(zone).toHaveClass("focus-visible:outline-accent");
    const input = zone.querySelector<HTMLInputElement>('input[type="file"]')!;
    const opened = vi.spyOn(input, "click");
    fireEvent.keyDown(zone, { key: "Enter" });
    fireEvent.keyDown(zone, { key: " " });
    fireEvent.keyDown(zone, { key: "a" });
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("takes no focus while disabled", () => {
    renderZone({ disabled: true });
    const zone = screen.getByRole("button", { name: /Drag & drop files here/ });
    expect(zone).toHaveAttribute("tabIndex", "-1");
    expect(zone).toHaveAttribute("aria-disabled", "true");
  });
});
