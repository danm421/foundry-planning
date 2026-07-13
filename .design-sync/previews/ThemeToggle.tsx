import { ThemeToggle } from "foundry-planning";

export function Default() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <ThemeToggle />
    </div>
  );
}

export function InToolbar() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div
        className="flex items-center justify-between border-b border-hair bg-card px-4 py-3"
        style={{ width: 420 }}
      >
        <span className="text-[13px] font-medium text-ink-2">
          Cooper household — Base plan
        </span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
