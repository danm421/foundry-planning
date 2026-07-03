// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  usePathname: () => "/clients/client-1/onboarding/estate",
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

function renderShell() {
  const statuses = STEPS.map((s) => ({ slug: s.slug, kind: "untouched" as const, gaps: [] }));
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <OnboardingShell clientId="client-1" activeStep="estate" statuses={statuses}>
        <DirtyReporter />
      </OnboardingShell>
    </ClientAccessProvider>,
  );
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
    expect(push).toHaveBeenCalledWith("/clients/client-1/onboarding/assumptions");
  });
});
