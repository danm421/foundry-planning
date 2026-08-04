// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EmailSettingsEditor from "@/components/intake/admin/email-settings-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })) as never);
});

const props = { initial: { fromName: "", subject: "", introBody: "" }, advisorName: "Jane Advisor", advisorEmail: "jane@acme.com", firmName: "Acme Wealth" };

describe("EmailSettingsEditor", () => {
  it("shows the From / Subject / Intro fields and a Save button", () => {
    render(<EmailSettingsEditor {...props} />);
    expect(screen.getByLabelText(/from name/i)).toBeTruthy();
    expect(screen.getByLabelText(/subject/i)).toBeTruthy();
    expect(screen.getByLabelText(/intro/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /save/i })).toBeTruthy();
  });

  // The preview is a sandboxed iframe, so its markup lives in srcdoc rather
  // than in the element's own innerHTML.
  const previewSrc = () =>
    screen.getByTestId("email-preview").getAttribute("srcdoc") ?? "";

  it("live preview reflects the firm name and the resolved advisor in the signature", () => {
    render(<EmailSettingsEditor {...props} />);
    // default intro resolves {{advisorName}} → Jane Advisor; signature shows the email
    expect(previewSrc()).toContain("Jane Advisor");
    expect(previewSrc()).toContain("mailto:jane@acme.com");
  });

  it("updates the preview as the intro changes", () => {
    render(<EmailSettingsEditor {...props} />);
    fireEvent.change(screen.getByLabelText(/intro/i), { target: { value: "Welcome {{clientName}}!" } });
    expect(previewSrc()).toContain("Welcome");
  });

  it("renders the preview in a frame that cannot execute scripts", () => {
    render(<EmailSettingsEditor {...props} />);
    const frame = screen.getByTestId("email-preview");
    expect(frame.tagName).toBe("IFRAME");
    const sandbox = frame.getAttribute("sandbox");
    expect(sandbox).not.toBeNull();
    // allow-scripts is the token that would defeat the whole control, and
    // pairing it with allow-same-origin would let the frame unsandbox itself.
    expect(sandbox?.split(/\s+/)).not.toContain("allow-scripts");
  });

  it("PUTs the settings on Save", async () => {
    render(<EmailSettingsEditor {...props} />);
    fireEvent.change(screen.getByLabelText(/from name/i), { target: { value: "Acme Wealth" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/data-collection/email-settings",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
