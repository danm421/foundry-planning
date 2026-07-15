// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock }) }));

const createMock = vi.fn();
const setActiveMock = vi.fn();
let isLoaded = true;
let isSignedIn = false;
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isSignedIn }),
}));
// The classic `{ isLoaded, signIn, setActive }` sign-in hook lives under
// `@clerk/nextjs/legacy` (the main `@clerk/nextjs` entry's `useSignIn` is the
// newer signals-based API and has no `create`/`setActive`) — see enter-client.tsx.
vi.mock("@clerk/nextjs/legacy", () => ({
  useSignIn: () => ({ isLoaded, signIn: { create: createMock }, setActive: setActiveMock }),
}));

import { EnterClient } from "../enter-client";

beforeEach(() => {
  replaceMock.mockReset();
  createMock.mockReset();
  setActiveMock.mockReset();
  isLoaded = true;
  isSignedIn = false;
  createMock.mockResolvedValue({ status: "complete", createdSessionId: "sess_1" });
});

describe("EnterClient", () => {
  it("consumes the ticket and redirects into the wizard", async () => {
    render(<EnterClient ticket="sit_abc" />);
    await waitFor(() => expect(setActiveMock).toHaveBeenCalledWith({ session: "sess_1" }));
    expect(createMock).toHaveBeenCalledWith({ strategy: "ticket", ticket: "sit_abc" });
    expect(replaceMock).toHaveBeenCalledWith("/portal/intake");
  });

  it("short-circuits to the wizard when already signed in", async () => {
    isSignedIn = true;
    render(<EnterClient ticket="sit_abc" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/portal/intake"));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("shows an error state when the ticket is rejected", async () => {
    createMock.mockRejectedValue(new Error("expired"));
    render(<EnterClient ticket="sit_bad" />);
    await waitFor(() => expect(screen.getByText(/expired/i)).toBeTruthy());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows an error state when no ticket is present", async () => {
    render(<EnterClient ticket={null} />);
    await waitFor(() => expect(screen.getByText(/expired/i)).toBeTruthy());
    expect(createMock).not.toHaveBeenCalled();
  });
});
