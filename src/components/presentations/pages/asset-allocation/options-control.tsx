"use client";
import {
  type AssetAllocationOptions,
  type SourceRef,
  ASSET_ALLOCATION_OPTIONS_DEFAULT,
  normalizeAssetAllocationOptions,
} from "@/lib/presentations/pages/asset-allocation/options-schema";
import { useInvestmentOptionCatalog } from "@/components/presentations/options-context";
import {
  OptionsRow,
  OptionsGroup,
} from "@/components/presentations/shared/options-layout";

const VIEWS: { key: AssetAllocationOptions["view"]; label: string }[] = [
  { key: "high_level", label: "By type" },
  { key: "detailed", label: "By class" },
  { key: "combined", label: "Combined" },
];

// SourceRef <-> <option> value encoding.
function encodeRef(ref: SourceRef | null): string {
  if (!ref) return "none";
  if (ref.kind === "recommended") return "recommended";
  return `${ref.kind}:${ref.id}`;
}
function decodeRef(v: string): SourceRef | null {
  if (v === "none") return null;
  if (v === "recommended") return { kind: "recommended" };
  const idx = v.indexOf(":");
  const kind = v.slice(0, idx);
  const id = v.slice(idx + 1);
  if (kind === "group") return { kind: "group", id };
  if (kind === "portfolio") return { kind: "portfolio", id };
  return null;
}

function SourceSelect({
  label, value, onChange, groups, portfolios, allowNone,
}: {
  label: string;
  value: SourceRef | null;
  onChange: (next: SourceRef | null) => void;
  groups: { key: string; name: string }[];
  portfolios: { id: string; name: string }[];
  allowNone: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">{label}</span>
      <select
        className="rounded border border-hair bg-card-2 px-2 py-1 text-ink"
        value={encodeRef(value)}
        onChange={(e) => onChange(decodeRef(e.target.value))}
      >
        {allowNone && <option value="none">None</option>}
        <option value="recommended">Recommended portfolio (plan default)</option>
        <optgroup label="Investment groups">
          {groups.map((g) => <option key={g.key} value={`group:${g.key}`}>{g.name}</option>)}
        </optgroup>
        <optgroup label="Model portfolios">
          {portfolios.map((p) => <option key={p.id} value={`portfolio:${p.id}`}>{p.name}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

export function AssetAllocationOptionsControl({
  value, onChange,
}: { value: AssetAllocationOptions; onChange: (next: AssetAllocationOptions) => void }) {
  const { groups, portfolios } = useInvestmentOptionCatalog();
  // Tolerate legacy/partial option blobs loaded from older templates.
  const v = normalizeAssetAllocationOptions(value);
  return (
    <OptionsRow>
      <OptionsGroup label="Portfolios">
        <SourceSelect
          label="Left"
          value={v.left}
          groups={groups}
          portfolios={portfolios}
          allowNone={false}
          onChange={(next) => onChange({ ...v, left: next ?? ASSET_ALLOCATION_OPTIONS_DEFAULT.left })}
        />
        <SourceSelect
          label="Right (comparison)"
          value={v.right}
          groups={groups}
          portfolios={portfolios}
          allowNone
          onChange={(next) => onChange({ ...v, right: next })}
        />
      </OptionsGroup>
      <OptionsGroup label="Breakdown">
        {VIEWS.map((view) => (
          <label key={view.key} className="flex items-center gap-2 hover:text-ink">
            <input type="radio" className="accent-accent" checked={v.view === view.key} onChange={() => onChange({ ...v, view: view.key })} />
            <span>{view.label}</span>
          </label>
        ))}
      </OptionsGroup>
      <OptionsGroup label="Display">
        <label className="flex items-center gap-2 hover:text-ink">
          <input type="checkbox" className="accent-accent" checked={v.includeOutOfEstate} onChange={(e) => onChange({ ...v, includeOutOfEstate: e.target.checked })} />
          <span>Include out-of-estate accounts</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input type="checkbox" className="accent-accent" checked={v.showTable} onChange={(e) => onChange({ ...v, showTable: e.target.checked })} />
          <span>Show allocation table</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input type="checkbox" className="accent-accent" checked={v.showExcluded} onChange={(e) => onChange({ ...v, showExcluded: e.target.checked })} />
          <span>Show excluded accounts</span>
        </label>
      </OptionsGroup>
    </OptionsRow>
  );
}
