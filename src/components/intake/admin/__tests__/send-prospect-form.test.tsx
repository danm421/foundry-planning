// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SendProspectForm from "../send-prospect-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("SendProspectForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
  });

  it("renders name and email inputs", () => {
    render(<SendProspectForm />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("submits POST /api/data-collection with correct body", async () => {
    render(<SendProspectForm />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Jane Smith" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "blank", recipientName: "Jane Smith", recipientEmail: "jane@example.com" }),
      });
    });
  });

  it("shows validation error for invalid email", async () => {
    const { container } = render(<SendProspectForm />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "not-an-email" } });
    // Use fireEvent.submit on the form to bypass jsdom constraint-validation
    // that blocks the click on a type=submit button
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/valid email/i);
    });
  });

  it("shows 429 rate limit error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    render(<SendProspectForm />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/rate limit/i);
    });
  });
});
