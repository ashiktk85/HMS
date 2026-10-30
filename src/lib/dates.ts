/** Date helpers. Dates are 'YYYY-MM-DD' strings in the hotel's timezone (India). */
const HOTEL_TZ = "Asia/Kolkata";

export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOTEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function isDateString(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole nights between two date strings (check-out minus check-in). */
export function diffDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

export function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    day: d.getUTCDate(),
    weekday: new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" }).format(d),
    month: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(d),
  };
}

/** "2026-10" -> { from: "2026-10-01", to: "2026-11-01" } (to is exclusive). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export type DateRange = { active: string; from: string; to: string; label: string };

/**
 * Turn ?range= (and ?from/?to for custom) into an inclusive date span in the hotel timezone.
 * Unknown values fall back to `fallback`; "all" is only honoured when `allowAll` is set.
 */
export function resolveRange(
  today: string,
  sp: { range?: string; from?: string; to?: string },
  opts: { fallback?: string; allowAll?: boolean; capAtToday?: boolean } = {},
): DateRange {
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${today.slice(0, 7)}-01`;
  let active = sp.range ?? opts.fallback ?? "today";
  let from = today;
  let to = today;
  if (active === "week") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    from = addDays(today, -((dow + 6) % 7)); // Monday
    to = addDays(from, 6);
  } else if (active === "month") {
    from = monthStart;
    to = addDays(monthRange(today.slice(0, 7)).to, -1);
  } else if (active === "last_month") {
    from = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
    to = addDays(monthStart, -1);
  } else if (active === "custom" && isDateString(sp.from) && isDateString(sp.to)) {
    [from, to] = sp.from <= sp.to ? [sp.from, sp.to] : [sp.to, sp.from];
  } else if (active === "all" && opts.allowAll) {
    return { active, from: "", to: "", label: "All dates" };
  } else {
    active = "today";
  }
  // Reporting views count "this week/month so far"; booking views want the whole period.
  if (opts.capAtToday && active !== "custom" && to > today) to = today;
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${d}T00:00:00Z`),
    );
  const label = active === "today" ? "Today" : from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
  return { active, from, to, label };
}

export function isMonthString(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}
