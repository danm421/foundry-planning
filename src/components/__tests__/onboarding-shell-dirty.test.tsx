// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import OnboardingShell from "@/app/(app)/clients/[id]/onboarding/onboarding-shell";
import { useSetOnboardingDirty } from "@/components/onboarding-dirty-context";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { STEPS } from "@/lib/onboarding/steps";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/client-1/onboarding/insurance",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/** Step-body stand-in that flags unsaved edits through the context. */
function DirtyReporter() {
  const setDirty = useSetOnboardingDirty();
  useEffect(() => {
    setDirty?.(true);
  }, [setDirty]);
  return <div data-testid="step-body" />;
}

function renderShellWith({
  activeKind = "untouched" as "untouched" | "in_progress" | "complete",
  permission = "edit" as "edit" | "view",
  dirty = true,
} = {}) {
  const statuses = STEPS.map((s) => ({
    slug: s.slug,
    kind: s.slug === "insurance" ? activeKind : ("untouched" as const),
    gaps: [],
  }));
  return render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <OnboardingShell clientId="client-1" activeStep="insurance" statuses={statuses}>
        {dirty ? <DirtyReporter /> : <div data-testid="step-body" />}
      </OnboardingShell>
    </ClientAccessProvider>,
  );
}

function renderShell() {
  return renderShellWith();
}

beforeEach(() => {
  push.mockClear();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
});

describe("OnboardingShell dirty-navigation guard", () => {
  it("blocks Next when the step is dirty and the confirm is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderShell();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates when the confirm is accepted", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderShell();
    await user.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/clients/client-1/onboarding/assumptions"),
    );
  });

  it("offers no Skip control — Next is the only forward action", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
  });
});

/** The PATCH bodies sent to the onboarding state endpoint, in call order. */
function skipPatchBodies() {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return calls
    .filter(([url]) => String(url) === "/api/clients/client-1/onboarding")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    .filter((b) => "skippedSteps" in b);
}

describe("OnboardingShell auto-skip on Next", () => {
  it("marks an untouched step skipped before navigating", async () => {
    const user = userEvent.setup();
    renderShellWith({ activeKind: "untouched", dirty: false });
    await user.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(skipPatchBodies()).toHaveLength(1));
    expect(skipPatchBodies()[0].skippedSteps).toContain("insurance");
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/clients/client-1/onboarding/assumptions"),
    );
  });

  it("does not skip a step that has data", async () => {
    const user = userEvent.setup();
    renderShellWith({ activeKind: "in_progress", dirty: false });
    await user.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/clients/client-1/onboarding/assumptions"),
    );
    expect(skipPatchBodies()).toHaveLength(0);
  });

  it("does not skip a completed step", async () => {
    const user = userEvent.setup();
    renderShellWith({ activeKind: "complete", dirty: false });
    await user.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/clients/client-1/onboarding/assumptions"),
    );
    expect(skipPatchBodies()).toHaveLength(0);
  });

  it("writes nothing for a viewer, but still navigates", async () => {
    const user = userEvent.setup();
    renderShellWith({ activeKind: "untouched", permission: "view", dirty: false });
    await user.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/clients/client-1/onboarding/assumptions"),
    );
    expect(skipPatchBodies()).toHaveLength(0);
  });

  it("navigates even when the skip write fails", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    renderShellWith({ activeKind: "untouched", dirty: false });
    await user.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/clients/client-1/onboarding/assumptions"),
    );
  });
});
