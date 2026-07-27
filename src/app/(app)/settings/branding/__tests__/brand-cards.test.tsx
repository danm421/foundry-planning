// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetCard, ColorCard } from "../brand-cards";

describe("AssetCard", () => {
  it("renders the empty state with an Upload button when initialUrl is null", () => {
    render(
      <AssetCard
        label="Logo"
        helper="PNG, JPEG, or WebP."
        accept="image/png"
        initialUrl={null}
        previewClass="h-16"
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("No logo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("renders the preview image plus Replace + Remove when initialUrl is set", () => {
    render(
      <AssetCard
        label="Logo"
        helper="PNG, JPEG, or WebP."
        accept="image/png"
        initialUrl="https://example.com/logo.png"
        previewClass="h-16"
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Logo preview" })).toHaveAttribute(
      "src",
      "https://example.com/logo.png",
    );
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("calls onUpload with the chosen file and swaps the preview to the returned URL", async () => {
    const onUpload = vi.fn().mockResolvedValue({ ok: true, url: "https://example.com/new.png" });
    const { container } = render(
      <AssetCard
        label="Logo"
        helper="PNG, JPEG, or WebP."
        accept="image/png"
        initialUrl={null}
        previewClass="h-16"
        onUpload={onUpload}
        onRemove={vi.fn()}
      />,
    );
    const file = new File(["x"], "logo.png", { type: "image/png" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(onUpload).toHaveBeenCalledWith(file);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Logo preview" })).toHaveAttribute(
        "src",
        "https://example.com/new.png",
      ),
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows the error and leaves the old URL in place when onUpload fails", async () => {
    const onUpload = vi.fn().mockResolvedValue({ ok: false, error: "Too big" });
    const { container } = render(
      <AssetCard
        label="Logo"
        helper="PNG, JPEG, or WebP."
        accept="image/png"
        initialUrl="https://example.com/old.png"
        previewClass="h-16"
        onUpload={onUpload}
        onRemove={vi.fn()}
      />,
    );
    const file = new File(["x"], "logo.png", { type: "image/png" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Too big")).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "Logo preview" })).toHaveAttribute(
      "src",
      "https://example.com/old.png",
    );
  });

  it("shows 'Nothing to remove' when onRemove returns a noop result", async () => {
    const onRemove = vi.fn().mockResolvedValue({ ok: true, noop: true });
    render(
      <AssetCard
        label="Logo"
        helper="PNG, JPEG, or WebP."
        accept="image/png"
        initialUrl="https://example.com/old.png"
        previewClass="h-16"
        onUpload={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    // The card always clears its local preview on any `ok: true` result,
    // noop included — the Remove button only renders when the card already
    // has a URL, so a noop response means client and server state have
    // drifted, and clearing converges the card back to the server's view.
    await waitFor(() => expect(screen.getByText("Nothing to remove")).toBeInTheDocument());
    expect(screen.getByText("No logo")).toBeInTheDocument();
  });

  it("shows 'Removed' and clears the preview on a plain ok remove", async () => {
    const onRemove = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AssetCard
        label="Logo"
        helper="PNG, JPEG, or WebP."
        accept="image/png"
        initialUrl="https://example.com/old.png"
        previewClass="h-16"
        onUpload={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByText("Removed")).toBeInTheDocument());
    expect(screen.getByText("No logo")).toBeInTheDocument();
  });
});

describe("ColorCard", () => {
  it("disables Save until the value differs from initial", () => {
    render(<ColorCard initial="#112233" onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("#0a2bff"), { target: { value: "#445566" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it('calls onSave with null when the field is cleared to ""', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    render(<ColorCard initial="#112233" onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText("#0a2bff"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });

  it("surfaces the error and keeps Save disabled at the saved value on failure", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: "Invalid color" });
    render(<ColorCard initial="#112233" onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText("#0a2bff"), { target: { value: "#445566" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Invalid color")).toBeInTheDocument());
  });
});
