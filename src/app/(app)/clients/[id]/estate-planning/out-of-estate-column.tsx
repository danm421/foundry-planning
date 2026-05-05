"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import type { ClientData } from "@/engine/types";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import { deriveTrustCardData, deriveHeirCardData, deriveCharityCardData } from "./lib/derive-card-data";
import { deriveRecipientBreaches } from "@/lib/gifts/derive-recipient-breaches";
import { TrustCard } from "./cards/trust-card";
import { HeirCard } from "./cards/heir-card";
import { CharityCard } from "./cards/charity-card";
import EntityDialog from "@/components/entity-dialog";
import FamilyMemberDialog from "@/components/family-member-dialog";
import ExternalBeneficiaryDialog from "@/components/external-beneficiary-dialog";

export function OutOfEstateColumn({
  tree,
  asOfYear,
  giftLedger,
}: {
  tree: ClientData;
  asOfYear: number;
  giftLedger: GiftLedgerYear[];
}) {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const [trustDialogOpen, setTrustDialogOpen] = useState(false);
  const [heirDialogOpen, setHeirDialogOpen] = useState(false);
  const [charityDialogOpen, setCharityDialogOpen] = useState(false);

  const recipientBreaches = deriveRecipientBreaches({
    ledger: giftLedger,
    gifts: tree.gifts ?? [],
    giftEvents: tree.giftEvents ?? [],
  });

  const trusts = deriveTrustCardData(tree, asOfYear, recipientBreaches);
  const heirs = deriveHeirCardData(tree, asOfYear, recipientBreaches);
  const charities = deriveCharityCardData(tree, recipientBreaches);

  return (
    <div>
      <Section title="Trusts" total={trusts.reduce((s, t) => s + t.total, 0)}>
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
        members={(tree.familyMembers ?? [])
          .filter((m) => m.role !== "client" && m.role !== "spouse")
          .map((m) => ({
            ...m,
            notes: null,
          }))}
        externals={(tree.externalBeneficiaries ?? []).map((e) => ({
          ...e,
          notes: null,
        }))}
        otherEntities={(tree.entities ?? []).filter((e) => e.name != null).map((e) => ({ id: e.id, name: e.name! }))}
        accounts={(tree.accounts ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          value: a.value,
          subType: a.subType,
          isDefaultChecking: a.isDefaultChecking,
          owners: a.owners,
        }))}
        liabilities={(tree.liabilities ?? []).map((l) => ({
          id: l.id,
          name: l.name,
          balance: l.balance,
          owners: l.owners,
        }))}
        incomes={(tree.incomes ?? []).map((i) => ({
          id: i.id,
          name: i.name,
          annualAmount: i.annualAmount,
          cashAccountId: i.cashAccountId,
        }))}
        expenses={(tree.expenses ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          annualAmount: e.annualAmount,
          cashAccountId: e.cashAccountId,
        }))}
        assetFamilyMembers={(tree.familyMembers ?? []).map((m) => ({
          id: m.id,
          // Engine FamilyMember uses `relationship` not `role`; map child→child, other→other.
          // NOTE (C3): This mapping never produces role:"client"|"spouse" because engine
          // FamilyMember rows do not include client/spouse (those live on tree.client).
          // The Assets tab is only reachable when `editing` is set, which cannot happen
          // from this create-only dialog — the Assets tab body is gated on
          // `editing && accounts !== undefined` in add-trust-form.tsx. If this dialog
          // is ever extended to support editing, thread DB-backed family_members rows
          // (with the `role` column) like family-view.tsx does, instead of this mapping.
          role: (m.relationship === "child" ? "child" : "other") as "client" | "spouse" | "child" | "other",
          firstName: m.firstName,
        }))}
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
