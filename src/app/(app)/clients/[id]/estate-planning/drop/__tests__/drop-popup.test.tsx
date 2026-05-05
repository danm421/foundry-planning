// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// Mock the three sub-forms so the composer's wiring is what's tested.
// Each mock exposes a button that fires `onSubmit` with a canned payload —
// we then assert what `onSave` (the prop the parent wires up) receives.
vi.mock(
  "@/app/(app)/clients/[id]/estate-planning/drop/gift-sub-form",
  () => ({
    GiftSubForm: vi.fn((props) => (
      <div data-testid="mock-gift-sub-form">
        <span data-testid="gift-recipient-kind">{props.recipientKind}</span>
        <span data-testid="gift-is-cash">{String(props.isCashAccount)}</span>
        <span data-testid="gift-year-min">{String(props.yearMin)}</span>
        <span data-testid="gift-year-max">{String(props.yearMax)}</span>
        <span data-testid="gift-growth">{String(props.growthRateForPreview)}</span>
        <span data-testid="gift-slice-pct">{String(props.ownerSlicePct)}</span>
        <span data-testid="gift-slice-value">
          {String(props.ownerSliceValueAtToday)}
        </span>
        <button
          type="button"
          data-testid="mock-gift-submit-one-time"
          onClick={() =>
            props.onSubmit({
              kind: "one-time",
              year: 2030,
              sliceFraction: 0.5,
              useCrummey: true,
              notes: "n",
            })
          }
        >
          submit-one-time
        </button>
        <button
          type="button"
          data-testid="mock-gift-submit-one-time-cash"
          onClick={() =>
            props.onSubmit({
              kind: "one-time",
              year: 2031,
              sliceFraction: 1,
              overrideAmount: 18_000,
              useCrummey: false,
            })
          }
        >
          submit-one-time-cash
        </button>
        <button
          type="button"
          data-testid="mock-gift-submit-recurring"
          onClick={() =>
            props.onSubmit({
              kind: "recurring",
              startYear: 2030,
              endYear: 2040,
              annualAmount: 18_000,
              inflationAdjust: true,
              useCrummey: true,
            })
          }
        >
          submit-recurring
        </button>
        <button
          type="button"
          data-testid="mock-gift-cancel"
          onClick={props.onCancel}
        >
          cancel
        </button>
      </div>
    )),
  }),
);

vi.mock(
  "@/app/(app)/clients/[id]/estate-planning/drop/bequest-sub-form",
  () => ({
    BequestSubForm: vi.fn((props) => (
      <div data-testid="mock-bequest-sub-form">
        <span data-testid="bequest-joint">
          {String(props.isJointOrFractional)}
        </span>
        <span data-testid="bequest-spouse-available">
          {String(props.spouseAvailable)}
        </span>
        <span data-testid="bequest-recipient-kind">{props.recipientKind}</span>
        <button
          type="button"
          data-testid="mock-bequest-submit"
          onClick={() =>
            props.onSubmit({
              grantorMode: "client",
              sliceFraction: 0.75,
              condition: "always",
            })
          }
        >
          submit
        </button>
        <button
          type="button"
          data-testid="mock-bequest-cancel"
          onClick={props.onCancel}
        >
          cancel
        </button>
      </div>
    )),
  }),
);

vi.mock(
  "@/app/(app)/clients/[id]/estate-planning/drop/retitle-sub-form",
  () => ({
    RetitleSubForm: vi.fn((props) => (
      <div data-testid="mock-retitle-sub-form">
        <span data-testid="retitle-recipient-kind">{props.recipientKind}</span>
        <button
          type="button"
          data-testid="mock-retitle-submit"
          onClick={() => props.onSubmit({ sliceFraction: 0.4 })}
        >
          submit
        </button>
        <button
          type="button"
          data-testid="mock-retitle-cancel"
          onClick={props.onCancel}
        >
          cancel
        </button>
      </div>
    )),
  }),
);

import { DropPopup } from "@/app/(app)/clients/[id]/estate-planning/drop/drop-popup";

const baseSource = {
  accountId: "acct-1",
  accountName: "Joint Brokerage",
  accountCategory: "investment",
  isCash: false,
  ownerKind: "family_member" as const,
  ownerId: "fm-1",
  ownerLabel: "Tom",
  ownerSlicePct: 0.6,
  ownerSliceValueToday: 1_200_000,
};

const trustTarget = {
  kind: "entity" as const,
  id: "ent-trust",
  label: "SLAT",
  isCharity: false,
};

const charityTarget = {
  kind: "external_beneficiary" as const,
  id: "ext-1",
  label: "Red Cross",
  isCharity: true,
};

function renderPopup(
  overrides: Partial<React.ComponentProps<typeof DropPopup>> = {},
) {
  const props: React.ComponentProps<typeof DropPopup> = {
    anchor: { clientX: 100, clientY: 100 },
    source: baseSource,
    target: trustTarget,
    growthRateForPreview: 0.05,
    yearMin: 2026,
    yearMax: 2060,
    spouseAvailable: true,
    giftLedger: [],
    taxInflationRate: 0.025,
    grantor: "client",
    getAnnualExclusion: () => 0,
    onSave: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...overrides,
  };
  const utils = render(<DropPopup {...props} />);
  return { ...utils, props };
}

describe("DropPopup", () => {
  beforeEach(() => {
    // Stable viewport for clamping tests.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 768,
    });
  });

  it("renders three radios (Gift / Bequest / Retitle) when target is trust", () => {
    renderPopup();
    expect(screen.getByRole("radio", { name: /gift/i })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /bequest/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /retitle/i })).toBeInTheDocument();
  });

  it("hides Retitle radio when target is charity", () => {
    renderPopup({ target: charityTarget });
    expect(screen.getByRole("radio", { name: /gift/i })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /bequest/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /retitle/i })).toBeNull();
  });

  it("renders the asset-class note when target is charity and account is appreciated (non-cash)", () => {
    renderPopup({ target: charityTarget });
    expect(
      screen.getByText(/charitable gift creates an income-tax deduction/i),
    ).toBeInTheDocument();
  });

  it("does NOT render the asset-class note when target is charity but account is cash", () => {
    renderPopup({
      target: charityTarget,
      source: { ...baseSource, isCash: true },
    });
    expect(
      screen.queryByText(/charitable gift creates an income-tax deduction/i),
    ).toBeNull();
  });

  it("does NOT render the asset-class note when target is a trust", () => {
    renderPopup();
    expect(
      screen.queryByText(/charitable gift creates an income-tax deduction/i),
    ).toBeNull();
  });

  it("when Gift selected (default), mounts <GiftSubForm> with the right props", () => {
    renderPopup();
    expect(screen.getByTestId("mock-gift-sub-form")).toBeInTheDocument();
    expect(screen.getByTestId("gift-recipient-kind")).toHaveTextContent("entity");
    expect(screen.getByTestId("gift-is-cash")).toHaveTextContent("false");
    expect(screen.getByTestId("gift-year-min")).toHaveTextContent("2026");
    expect(screen.getByTestId("gift-year-max")).toHaveTextContent("2060");
    expect(screen.getByTestId("gift-growth")).toHaveTextContent("0.05");
    expect(screen.getByTestId("gift-slice-pct")).toHaveTextContent("0.6");
    expect(screen.getByTestId("gift-slice-value")).toHaveTextContent("1200000");
  });

  it("when Bequest selected, mounts <BequestSubForm> with isJointOrFractional derived from source.ownerSlicePct < 1", async () => {
    const user = userEvent.setup();
    renderPopup();
    await user.click(screen.getByRole("radio", { name: /bequest/i }));
    expect(screen.getByTestId("mock-bequest-sub-form")).toBeInTheDocument();
    expect(screen.getByTestId("bequest-joint")).toHaveTextContent("true");
    expect(screen.getByTestId("bequest-spouse-available")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("bequest-recipient-kind")).toHaveTextContent(
      "entity",
    );
  });

  it("Bequest isJointOrFractional is false when ownerSlicePct === 1", async () => {
    const user = userEvent.setup();
    renderPopup({ source: { ...baseSource, ownerSlicePct: 1 } });
    await user.click(screen.getByRole("radio", { name: /bequest/i }));
    expect(screen.getByTestId("bequest-joint")).toHaveTextContent("false");
  });

  it("forwards spouseAvailable=false to BequestSubForm", async () => {
    const user = userEvent.setup();
    renderPopup({ spouseAvailable: false });
    await user.click(screen.getByRole("radio", { name: /bequest/i }));
    expect(screen.getByTestId("bequest-spouse-available")).toHaveTextContent(
      "false",
    );
  });

  it("when Retitle selected, mounts <RetitleSubForm>", async () => {
    const user = userEvent.setup();
    renderPopup();
    await user.click(screen.getByRole("radio", { name: /retitle/i }));
    expect(screen.getByTestId("mock-retitle-sub-form")).toBeInTheDocument();
    expect(screen.getByTestId("retitle-recipient-kind")).toHaveTextContent(
      "entity",
    );
  });

  it("popup auto-clamps to viewport (anchor near right edge moves left)", () => {
    const { container } = renderPopup({
      anchor: { clientX: 1000, clientY: 100 },
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    // popup width 480, viewport 1024 → clamp left to 1024 - 480 = 544
    expect(dialog.style.left).toBe("544px");
  });

  it("Escape key calls onCancel", () => {
    const onCancel = vi.fn();
    renderPopup({ onCancel });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("backdrop click calls onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderPopup({ onCancel });
    await user.click(screen.getByTestId("drop-popup-backdrop"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("close (✕) button calls onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderPopup({ onCancel });
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("header shows 'Transfer {ownerLabel}'s {ownerSlicePct%} of {accountName}'", () => {
    renderPopup();
    // header uses &rsquo; (’) for the apostrophe
    expect(
      screen.getByRole("heading", {
        name: /transfer tom’s 60% of joint brokerage/i,
      }),
    ).toBeInTheDocument();
  });

  it("on GiftSubForm submit (one-time, non-cash) calls onSave with kind: 'gift-one-time'", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPopup({ onSave });
    await user.click(screen.getByTestId("mock-gift-submit-one-time"));
    expect(onSave).toHaveBeenCalledWith({
      kind: "gift-one-time",
      year: 2030,
      sliceFraction: 0.5,
      useCrummey: true,
      overrideAmount: undefined,
      notes: "n",
    });
  });

  it("on GiftSubForm submit (one-time, cash with overrideAmount) forwards overrideAmount", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPopup({ source: { ...baseSource, isCash: true }, onSave });
    await user.click(screen.getByTestId("mock-gift-submit-one-time-cash"));
    expect(onSave).toHaveBeenCalledWith({
      kind: "gift-one-time",
      year: 2031,
      sliceFraction: 1,
      useCrummey: false,
      overrideAmount: 18_000,
      notes: undefined,
    });
  });

  it("on GiftSubForm submit (recurring) calls onSave with kind: 'gift-recurring'", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPopup({ onSave });
    await user.click(screen.getByTestId("mock-gift-submit-recurring"));
    expect(onSave).toHaveBeenCalledWith({
      kind: "gift-recurring",
      startYear: 2030,
      endYear: 2040,
      annualAmount: 18_000,
      inflationAdjust: true,
      useCrummey: true,
    });
  });

  it("on BequestSubForm submit calls onSave with kind: 'bequest' + spread payload", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPopup({ onSave });
    await user.click(screen.getByRole("radio", { name: /bequest/i }));
    await user.click(screen.getByTestId("mock-bequest-submit"));
    expect(onSave).toHaveBeenCalledWith({
      kind: "bequest",
      grantorMode: "client",
      sliceFraction: 0.75,
      condition: "always",
    });
  });

  it("on RetitleSubForm submit calls onSave with kind: 'retitle' + sliceFraction", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPopup({ onSave });
    await user.click(screen.getByRole("radio", { name: /retitle/i }));
    await user.click(screen.getByTestId("mock-retitle-submit"));
    expect(onSave).toHaveBeenCalledWith({
      kind: "retitle",
      sliceFraction: 0.4,
    });
  });

  it("sub-form onCancel passes through to popup onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderPopup({ onCancel });
    await user.click(screen.getByTestId("mock-gift-cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
