// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// AdvisorBrandForm wires AssetCard to these "use server" actions. None of
// the cases below interact with the asset cards, so a bare mock is enough —
// this just keeps the module import from touching Clerk/DB/blob code in
// jsdom, matching the house pattern (see beta-codes-client.test.tsx).
vi.mock("../advisor-actions", () => ({
  uploadAdvisorBrandingAsset: vi.fn(),
  removeAdvisorBrandingAsset: vi.fn(),
}));

import AdvisorBrandForm from "../advisor-brand-form";

const ALL_NULL_INITIAL = {
  brandName: null,
  primaryColor: null,
  contactEmail: null,
  contactPhone: null,
  website: null,
  address: null,
  emailFromName: null,
  emailReplyTo: null,
  logoUrl: null,
  faviconUrl: null,
};

function stubFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ profile: {} }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetch400(fieldErrors: Record<string, string[]>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: { fieldErrors, formErrors: [] } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AdvisorBrandForm", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts only the dirty keys, using "" for a cleared field, and never logoUrl/faviconUrl', async () => {
    const fetchMock = stubFetchOk();
    render(
      <AdvisorBrandForm
        initial={{
          ...ALL_NULL_INITIAL,
          brandName: "Old Name",
          contactEmail: "old@example.com",
          logoUrl: "https://example.com/logo.png",
        }}
        brandingEnabled
        canEdit
      />,
    );

    // brandName changes to a new value; contactEmail is cleared; every other
    // field (including primaryColor, website, etc.) is left untouched.
    fireEvent.change(screen.getByLabelText("Brand name"), {
      target: { value: "New Name" },
    });
    fireEvent.change(screen.getByLabelText("Contact email"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/advisor-branding");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ brandName: "New Name", contactEmail: "" });
    expect(body).not.toHaveProperty("logoUrl");
    expect(body).not.toHaveProperty("faviconUrl");
  });

  it("disables Save when nothing is dirty", () => {
    render(
      <AdvisorBrandForm
        initial={{ ...ALL_NULL_INITIAL, brandName: "Foo" }}
        brandingEnabled
        canEdit
      />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Brand name"), {
      target: { value: "Bar" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("maps a 400 fieldErrors response onto the matching input", async () => {
    const fetchMock = stubFetch400({ website: ["Enter a valid http(s) URL"] });
    render(<AdvisorBrandForm initial={ALL_NULL_INITIAL} brandingEnabled canEdit />);

    fireEvent.change(screen.getByLabelText("Website"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("Enter a valid http(s) URL")).toBeInTheDocument(),
    );
  });

  it("renders the read-only message and no Save button when canEdit is false", () => {
    render(
      <AdvisorBrandForm initial={ALL_NULL_INITIAL} brandingEnabled={false} canEdit={false} />,
    );
    expect(
      screen.getByText("Your firm hasn't enabled custom branding."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows the first-person grant-off notice when subjectName is absent (self mode)", () => {
    render(
      <AdvisorBrandForm initial={ALL_NULL_INITIAL} brandingEnabled={false} canEdit />,
    );
    expect(screen.getByText(/^Your branding grant is off\./)).toBeInTheDocument();
  });

  it("switches the grant-off notice to third person when subjectName is set (admin editing another advisor)", () => {
    render(
      <AdvisorBrandForm
        initial={ALL_NULL_INITIAL}
        brandingEnabled={false}
        canEdit
        subjectName="Pat Advisor"
      />,
    );
    expect(screen.getByText(/^Pat Advisor's branding grant is off\./)).toBeInTheDocument();
    expect(screen.queryByText(/^Your branding grant is off\./)).not.toBeInTheDocument();
  });
});
