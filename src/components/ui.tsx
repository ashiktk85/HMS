export const inputCls =
  "w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm";
export const btnPrimary =
  "rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60";
export const btnSoft =
  "rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-sm font-medium text-[var(--brand)] transition hover:opacity-80 disabled:opacity-60";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "info";
}) {
  const tones = {
    neutral: "bg-stone-100 text-stone-700",
    ok: "bg-[var(--brand-soft)] text-[var(--brand)]",
    warn: "bg-amber-50 text-amber-800",
    danger: "bg-rose-50 text-rose-800",
    info: "bg-sky-50 text-sky-800",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "md" | "lg";
}) {
  const text =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  const dims = size === "lg" ? "h-16 w-16 text-xl" : "h-9 w-9 text-xs";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] font-semibold text-[var(--brand)] ${dims}`}
    >
      {text}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-sm text-[var(--muted)]">
      {message}
    </div>
  );
}

export function roomStatusTone(status: string) {
  if (status === "available") return "ok" as const;
  if (status === "occupied" || status === "reserved") return "info" as const;
  if (status === "dirty" || status === "cleaning" || status === "inspection")
    return "warn" as const;
  return "danger" as const;
}

/** Labelled form control: visible label above, optional hint below. */
export function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-[var(--ink)]">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  );
}
