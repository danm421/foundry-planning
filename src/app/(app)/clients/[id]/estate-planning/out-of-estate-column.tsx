"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import type { ClientData } from "@/engine/types";
import { deriveTrustCardData, deriveHeirCardData, deriveCharityCardData } from "./lib/derive-card-data";
import { TrustCard } from "./cards/trust-card";
import { HeirCard } from "./cards/heir-card";
import { CharityCard } from "./cards/charity-card";
import EntityDialog from "@/components/entity-dialog";
import FamilyMemberDialog from "@/components/family-member-dialog";
import ExternalBeneficiaryDialog from "@/components/external-beneficiary-dialog";

export function OutOfEstateColumn({ tree, asOfYear }: { tree: ClientData; asOfYear: number }) {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const [trustDialogOpen, setTrustDialogOpen] = useState(false);
  const [heirDialogOpen, setHeirDialogOpen] = useState(false);
  const [charityDialogOpen, setCharityDialogOpen] = useState(false);

  const trusts = deriveTrustCardData(tree, asOfYear);
  const heirs = deriveHeirCardData(tree, asOfYear);
  const charities = deriveCharityCardData(tree);

  return (
    <div>
      <Section title="Trusts" total={trusts.reduce((s, t) => s + t.totalValue, 0)}>
        {trusts.length === 0 ? (
          <Empty label="No trusts yet" />
        ) : (
          trusts.map((t) => <TrustCard key={t.entityId} data={t} />)
        )}
        <AddRow label="+ Create new trust" onClick={() => setTrustDialogOpen(true)} />
      </Section>

      <Section title="Heirs" total={null}>
        {heirs.length === 0 ? (
          <Empty label="No heirs yet" />
        ) : (
          heirs.map((h) => <HeirCard key={h.familyMemberId} data={h} />)
        )}
        <AddRow label="+ Add heir" onClick={() => setHeirDialogOpen(true)} />
      </Section>

      <Section title="Charities" total={null}>
        {charities.length === 0 ? (
          <Empty label="No charities yet" />
        ) : (
          charities.map((c) => <CharityCard key={c.externalBeneficiaryId} data={c} />)
        )}
        <AddRow label="+ Add charity" onClick={() => setCharityDialogOpen(true)} />
      </Section>

      <EntityDialog
        clientId={clientId}
        open={trustDialogOpen}
        onOpenChange={setTrustDialogOpen}
        createKind="trust"
        household={{
          client: { firstName: tree.client.firstName },
          spouse: tree.client.spouseName ? { firstName: tree.client.spouseName } : null,
        }}
        members={(tree.familyMembers ?? []).map((m) => ({
          ...m,
          notes: null,
        }))}
        externals={(tree.externalBeneficiaries ?? []).map((e) => ({
          ...e,
          notes: null,
        }))}
        otherEntities={(tree.entities ?? []).filter((e) => e.name != null).map((e) => ({ id: e.id, name: e.name! }))}
        onSaved={() => {
          setTrustDialogOpen(false);
          router.refresh();
        }}
      />

      {heirDialogOpen && (
        <FamilyMemberDialog
          clientId={clientId}
          open={heirDialogOpen}
          onOpenChange={setHeirDialogOpen}
          onSaved={() => {
            setHeirDialogOpen(false);
            router.refresh();
          }}
        />
      )}

      {charityDialogOpen && (
        <ExternalBeneficiaryDialog
          clientId={clientId}
          open={charityDialogOpen}
          onOpenChange={setCharityDialogOpen}
          onSaved={() => {
            setCharityDialogOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Section({ title, total, children }: { title: string; total: number | null; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--color-hair)] last:border-b-0">
      <header className="flex items-baseline justify-between border-b border-[var(--color-hair)] px-5 py-3">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">{title}</span>
        {total != null && (
          <span className="text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">
            {total.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
          </span>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-5 py-4 text-center text-xs text-[var(--color-ink-3)]">{label}</div>;
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full border-t border-dashed border-[var(--color-hair-2)] px-5 py-3 text-left text-[12px] text-[var(--color-ink-3)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-accent-ink)]"
    >
      {label}
    </button>
  );
}
