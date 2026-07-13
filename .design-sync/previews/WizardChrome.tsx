import { WizardChrome } from "foundry-planning";

const STEP_LABELS = [
  "Basics",
  "Income",
  "Expenses",
  "Accounts",
  "Savings",
  "Life insurance",
  "Assumptions",
] as const;

const noop = () => {};

export function FirstStep() {
  return (
    <div className="bg-paper text-ink font-sans p-6" style={{ width: 640 }}>
      <WizardChrome
        stepLabels={STEP_LABELS}
        current={0}
        title="Household basics"
        backDisabled
        onBack={noop}
        onNext={noop}
      >
        <p className="text-[13px] leading-relaxed text-ink-2">
          Confirm names, dates of birth, and filing status for Marcus and Elena
          Cooper before moving on to income sources.
        </p>
      </WizardChrome>
    </div>
  );
}

export function MiddleStep() {
  return (
    <div className="bg-paper text-ink font-sans p-6" style={{ width: 640 }}>
      <WizardChrome
        stepLabels={STEP_LABELS}
        current={3}
        title="Accounts"
        onBack={noop}
        onNext={noop}
      >
        <ul className="space-y-2 text-[13px] text-ink-2">
          <li className="flex items-center justify-between border-b border-hair pb-2">
            <span>Schwab brokerage</span>
            <span className="tabular">$1,284,500</span>
          </li>
          <li className="flex items-center justify-between border-b border-hair pb-2">
            <span>Vanguard 401(k) — Elena</span>
            <span className="tabular">$912,300</span>
          </li>
        </ul>
      </WizardChrome>
    </div>
  );
}

export function LastStepBusy() {
  return (
    <div className="bg-paper text-ink font-sans p-6" style={{ width: 640 }}>
      <WizardChrome
        stepLabels={STEP_LABELS}
        current={6}
        title="Assumptions"
        nextLabel="Finish → Solver"
        busy
        onBack={noop}
        onNext={noop}
      >
        <p className="text-[13px] leading-relaxed text-ink-2">
          Inflation, growth, and Social Security assumptions default to the
          firm model portfolio. Saving your quick start now.
        </p>
      </WizardChrome>
    </div>
  );
}
