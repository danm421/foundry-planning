"use client";

import type { TypeContribution } from "@/lib/investments/allocation";
import type { AssetTypeId } from "@/lib/investments/asset-types";
import {
  colorForAssetType,
  shadeForClassInType,
} from "@/lib/investments/palette";

interface Props {
  typeId: AssetTypeId;
  typeLabel: string;
  typeValue: number;
  typePctOfClassified: number;
  classes: TypeContribution[];
  onBack: () => void;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
function dollars(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function AllocationTypeDrill({
  typeId, typeLabel, typeValue, typePctOfClassified, classes, onBack,
}: Props) {
  const totalValue = classes.reduce((a, c) => a + c.subtotal, 0);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs text-gray-400 hover:text-gray-200"
      >
        ← All asset types
      </button>

      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: colorForAssetType(typeId) }}
          />
          {typeLabel}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {dollars(typeValue)} · {pct(typePctOfClassified)} of classified
        </div>
      </div>

      {classes.length === 0 ? (
        <div className="text-xs text-gray-500">No classes contribute to this type.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {classes.map((cls, idx) => {
            const color = shadeForClassInType(typeId, idx, classes.length);
            return (
              <ClassSection key={cls.assetClassId} cls={cls} color={color} />
            );
          })}
          <div className="flex items-center justify-between border-t border-gray-700 pt-2 text-xs font-semibold text-gray-200">
            <span>Grand Total</span>
            <span className="tabular-nums">
              {dollars(totalValue)}  ·  {pct(typePctOfClassified)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ClassSection({ cls, color }: { cls: import("@/lib/investments/allocation").TypeContribution; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-gray-200">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
          {cls.assetClassName}
        </span>
        <span className="tabular-nums text-gray-300">{dollars(cls.subtotal)}</span>
      </div>
      {cls.contributions.length === 0 ? (
        <div className="ml-4 text-xs text-gray-500">No accounts.</div>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="px-2 py-1 font-medium">Account</th>
              <th className="px-2 py-1 text-right font-medium">$ in class</th>
              <th className="px-2 py-1 text-right font-medium">% of class</th>
            </tr>
          </thead>
          <tbody>
            {cls.contributions.map((c) => {
              const pctOfClass = cls.subtotal > 0 ? c.valueInClass / cls.subtotal : 0;
              return (
                <tr key={c.accountId} className="border-b border-gray-900">
                  <td className="px-2 py-1 text-gray-200">{c.accountName}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-200">{dollars(c.valueInClass)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-200">{pct(pctOfClass)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-gray-800 text-xs text-gray-400">
              <td className="px-2 py-1">Subtotal</td>
              <td className="px-2 py-1 text-right tabular-nums">{dollars(cls.subtotal)}</td>
              <td className="px-2 py-1 text-right">—</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
