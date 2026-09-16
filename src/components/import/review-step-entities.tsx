"use client";

import type { ExtractedEntity, EntityType } from "@/lib/extraction/types";
import { inputClassName, selectClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import SourceBadge from "./source-badge";

// Layered on top of selectClassName's own baseline to flag fields the AI
// didn't extract.
const TINT_EMPTY = "bg-warn/10 border-warn/40";

const ENTITY_TYPE_OPTIONS: { value: EntityType; label: string }[] = [
  { value: "trust", label: "Trust" },
  { value: "llc", label: "LLC" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "partnership", label: "Partnership" },
  { value: "foundation", label: "Foundation" },
  { value: "other", label: "Other" },
];

interface ReviewStepEntitiesProps {
  entities: ExtractedEntity[];
  onChange: (entities: ExtractedEntity[]) => void;
}

const EMPTY_CLASS = `${inputClassName} ${TINT_EMPTY}`;

export default function ReviewStepEntities({
  entities,
  onChange,
}: ReviewStepEntitiesProps) {
  const updateField = (index: number, field: keyof ExtractedEntity, value: unknown) => {
    const updated = entities.map((e, i) =>
      i === index ? { ...e, [field]: value } : e
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([...entities, { name: "" }]);
  };

  const removeRow = (index: number) => {
    onChange(entities.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-ink">
          Entities ({entities.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-card-2 px-3 py-1.5 text-sm text-accent hover:bg-card-hover"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {entities.map((entity, i) => (
          <div key={i} className="rounded-lg border border-hair bg-card-2 p-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={fieldLabelClassName}>Name</label>
                <input
                  value={entity.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={entity.name ? inputClassName : EMPTY_CLASS}
                  placeholder="Entity name"
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>Type</label>
                <select
                  value={entity.entityType ?? ""}
                  onChange={(e) => updateField(i, "entityType", e.target.value || undefined)}
                  className={entity.entityType ? selectClassName : `${selectClassName} ${TINT_EMPTY}`}
                >
                  <option value="">Select...</option>
                  {ENTITY_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <SourceBadge row={entity} className="pb-1" />
                <button
                  onClick={() => removeRow(i)}
                  className="pb-1 text-white hover:text-white"
                  title="Remove"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
