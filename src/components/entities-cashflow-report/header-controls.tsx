"use client";

import { YearRangeSlider } from "@/components/cashflow/year-range-slider";

export interface EntityOption {
  id: string;
  name: string;
  entityType: string;
}

interface Props {
  entities: EntityOption[];
  selectedEntityId: string;
  onSelectEntity: (id: string) => void;
  yearRange: [number, number];
  minYear: number;
  maxYear: number;
  clientRetirementYear: number | null;
  onYearRangeChange: (next: [number, number]) => void;
  exporting: boolean;
  onExportPdf: () => void;
}

export default function HeaderControls(props: Props) {
  const trusts = props.entities.filter((e) => e.entityType === "trust");
  const businesses = props.entities.filter((e) => e.entityType !== "trust");

  return (
    <div className="flex flex-col gap-4 border-b border-gray-800 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <span className="text-gray-400">Entity</span>
          <select
            className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none"
            value={props.selectedEntityId}
            onChange={(e) => props.onSelectEntity(e.target.value)}
          >
            {trusts.length > 0 && (
              <optgroup label="Trusts">
                {trusts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            )}
            {businesses.length > 0 && (
              <optgroup label="Businesses">
                {businesses.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button
          type="button"
          disabled={props.exporting}
          onClick={props.onExportPdf}
          className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-accent-on transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {props.exporting ? "Exporting…" : "Export PDF"}
        </button>
      </div>
      <YearRangeSlider
        min={props.minYear}
        max={props.maxYear}
        value={props.yearRange}
        onChange={props.onYearRangeChange}
        clientRetirementYear={props.clientRetirementYear}
      />
    </div>
  );
}
