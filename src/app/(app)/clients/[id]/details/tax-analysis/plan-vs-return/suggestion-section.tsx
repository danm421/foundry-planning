export function SuggestionSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{title}</h3>
      {children}
    </section>
  );
}
