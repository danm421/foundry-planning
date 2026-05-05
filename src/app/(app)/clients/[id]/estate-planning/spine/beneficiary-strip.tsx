"use client";

import { useState } from "react";
import { BeneficiaryCard } from "./beneficiary-card";
import type { BeneficiaryCardData } from "./lib/derive-spine-data";

export function BeneficiaryStrip({ cards }: { cards: BeneficiaryCardData[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-4 gap-2 my-3">
      {cards.map((c, i) => (
        <BeneficiaryCard
          key={i}
          name={c.name}
          relationship={c.relationship}
          detail={c.detail}
          expanded={openIdx === i}
          onToggle={() => setOpenIdx((cur) => (cur === i ? null : i))}
          isTrustRemainder={c.isTrustRemainder}
        />
      ))}
    </div>
  );
}
