import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";

export type { IconName };


export type Tone = "green" | "amber" | "sky" | "violet" | "rose" | "orange";

// Literal class strings so Tailwind picks them up.
const TONES: Record<Tone, { icon: string; bar: string }> = {
  green: { icon: "bg-emerald-50 text-emerald-700", bar: "from-emerald-400 to-emerald-600" },
  amber: { icon: "bg-amber-50 text-amber-700", bar: "from-amber-300 to-amber-500" },
  sky: { icon: "bg-sky-50 text-sky-700", bar: "from-sky-300 to-sky-500" },
  violet: { icon: "bg-violet-50 text-violet-700", bar: "from-violet-300 to-violet-500" },
  rose: { icon: "bg-rose-50 text-rose-700", bar: "from-rose-300 to-rose-500" },
  orange: { icon: "bg-orange-50 text-orange-700", bar: "from-orange-300 to-orange-500" },
};

export function Stat({
  label,
  value,
  href,
  hint,
  icon,
  tone = "green",
}: {
  label: string;
  value: string;
  href?: string;
  hint?: string;
  icon: IconName;
  tone?: Tone;
}) {
  const t = TONES[tone];
  const body = (
    <div
      className={`group relative h-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_2px_rgba(16,24,16,0.04)] transition ${
        href ? "hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-md" : ""
      }`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.bar}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-[var(--ink)]">{value}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.icon}`}>
          <Icon name={icon} />
        </span>
      </div>
      {hint ? <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function QuickAction({ href, label, icon, tone }: { href: string; label: string; icon: IconName; tone: Tone }) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-3 py-4 text-center text-sm font-medium text-[var(--ink)] shadow-[0_1px_2px_rgba(16,24,16,0.04)] transition hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-md"
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl transition group-hover:scale-105 ${TONES[tone].icon}`}>
        <Icon name={icon} />
      </span>
      {label}
    </Link>
  );
}

export const RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
] as const;

export function RangeFilter({
  basePath,
  active,
  from,
  to,
  preserve = {},
  showAll = false,
}: {
  basePath: string;
  active: string;
  from: string;
  to: string;
  /** Other query params to keep when changing the range (e.g. status, search). */
  preserve?: Record<string, string | undefined>;
  /** Offer an "All dates" pill. */
  showAll?: boolean;
}) {
  const kept = Object.entries(preserve).filter((e): e is [string, string] => !!e[1]);
  const hrefFor = (key: string) => {
    const p = new URLSearchParams(kept);
    p.set("range", key);
    return `${basePath}?${p.toString()}`;
  };
  const options = showAll ? [...RANGES, { key: "all", label: "All dates" }] : RANGES;
  const pill = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
      on ? "bg-[var(--brand)] text-white shadow-sm" : "text-[var(--muted)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand)]"
    }`;
  const dateCls = "rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-2 shadow-[0_1px_2px_rgba(16,24,16,0.04)]">
      <div className="flex flex-wrap gap-1">
        {options.map((r) => (
          <Link key={r.key} href={hrefFor(r.key)} className={pill(active === r.key)}>
            {r.label}
          </Link>
        ))}
      </div>
      <form className="ml-auto flex flex-wrap items-center gap-2 text-sm" action={basePath}>
        {kept.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="range" value="custom" />
        <input type="date" name="from" defaultValue={from || undefined} required className={dateCls} aria-label="From date" />
        <span className="text-[var(--muted)]">to</span>
        <input type="date" name="to" defaultValue={to || undefined} required className={dateCls} aria-label="To date" />
        <button type="submit" className={pill(active === "custom")}>
          Apply
        </button>
      </form>
    </div>
  );
}
