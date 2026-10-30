import Link from "next/link";
import {
  PageHeader,
  Panel,
  StatusPill,
  EmptyState,
  inputCls,
  btnPrimary,
  btnSoft,
} from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";
import { resolveRange, todayLocal } from "@/lib/dates";
import { RangeFilter } from "../dashboard/parts";
import { BOOKING_STATUSES, bookingLabel, bookingTone, formatDate, formatMoney, labelize, rel } from "@/lib/types";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; when?: string; range?: string; from?: string; to?: string }>;
}) {
  const { status, q, when, range: rangeParam, from: fromParam, to: toParam } = await searchParams;
  const today = todayLocal();
  const supabase = await createClient();
  // Bookings open on today's stays by default; a status, search or front-desk shortcut looks at all dates.
  const range = resolveRange(
    today,
    { range: rangeParam, from: fromParam, to: toParam },
    { fallback: status || q || when ? "all" : "today", allowAll: true },
  );

  let query = supabase
    .from("bookings")
    .select("*, guests(full_name), rooms(room_number)")
    .order("created_at", { ascending: false });
  if (status && (BOOKING_STATUSES as string[]).includes(status)) {
    query = query.eq("status", status);
  }

  // Stays that overlap the chosen dates (including guests leaving on the first day).
  if (range.active !== "all") {
    query = query.lte("check_in_date", range.to).gte("check_out_date", range.from);
  }

  // Front-desk shortcuts: who is due in today, and who is due out today.
  if (when === "arriving") {
    query = query.eq("check_in_date", today).in("status", ["confirmed", "hold"]);
  } else if (when === "departing") {
    query = query.eq("check_out_date", today).eq("status", "checked_in");
  }

  // Search by booking code or guest name; strip characters that break the filter string.
  const term = (q || "").replace(/[,()%*\\]/g, " ").trim();
  if (term) {
    const { data: guestHits } = await supabase
      .from("guests")
      .select("id")
      .ilike("full_name", `%${term}%`)
      .limit(50);
    const ids = (guestHits || []).map((g) => g.id);
    query = query.or(
      ids.length
        ? `booking_code.ilike.%${term}%,guest_id.in.(${ids.join(",")})`
        : `booking_code.ilike.%${term}%`,
    );
  }
  const { data: bookings } = await query.limit(100);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${
      active
        ? "bg-[var(--brand-soft)] text-[var(--brand)]"
        : "border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--brand-tint)]"
    }`;
  const withQ = (s?: string, w?: string) => {
    const params = new URLSearchParams();
    if (s) params.set("status", s);
    if (w) params.set("when", w);
    if (term) params.set("q", term);
    params.set("range", range.active);
    if (range.active === "custom") {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    const str = params.toString();
    return str ? `/bookings?${str}` : "/bookings";
  };

  return (
    <div>
      <PageHeader
        title="Bookings"
        description="Walk-in, direct, phone and WhatsApp bookings. Overlapping bookings on one room are blocked."
        actions={
          <>
            <Link href="/bookings/calendar" className={btnSoft}>
              Calendar
            </Link>
            <Link href="/bookings/new" className={btnPrimary}>
              New booking
            </Link>
          </>
        }
      />
      <div className="mb-4">
        <RangeFilter
          basePath="/bookings"
          active={range.active}
          from={range.from}
          to={range.to}
          showAll
          preserve={{ status, when, q: term }}
        />
        <p className="mt-2 px-1 text-xs text-[var(--muted)]">
          Showing stays on {range.label === "Today" ? "today" : range.label.toLowerCase() === "all dates" ? "all dates" : range.label}.
        </p>
      </div>
      <Panel className="mb-4 space-y-3">
        <form className="flex gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {when ? <input type="hidden" name="when" value={when} /> : null}
          <input type="hidden" name="range" value={range.active === "today" ? "all" : range.active} />
          {range.active === "custom" ? (
            <>
              <input type="hidden" name="from" value={range.from} />
              <input type="hidden" name="to" value={range.to} />
            </>
          ) : null}
          <input
            name="q"
            defaultValue={q || ""}
            placeholder="Search booking code or guest name"
            className={inputCls}
          />
          <button type="submit" className={btnSoft}>
            Search
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Link href={withQ()} className={chip(!status && !when)}>
            All
          </Link>
          <Link href={withQ(undefined, "arriving")} className={chip(when === "arriving")}>
            Arriving today
          </Link>
          <Link href={withQ(undefined, "departing")} className={chip(when === "departing")}>
            Departing today
          </Link>
          {BOOKING_STATUSES.map((s) => (
            <Link key={s} href={withQ(s)} className={chip(status === s)}>
              {bookingLabel(s)}
            </Link>
          ))}
        </div>
      </Panel>
      {!bookings?.length ? (
        <EmptyState message={
            range.active !== "all"
              ? `No bookings for ${range.label.toLowerCase() === "today" ? "today" : range.label}. Try another range or All dates.`
              : term || status || when
                ? "No bookings match."
                : "No bookings yet."
          }
        />
      ) : (
        <Panel>
          <DataTable
            searchable={false}
            columns={[
              { header: "Code" },
              { header: "Guest", maxWidth: "16rem" },
              { header: "Room" },
              { header: "Check-in" },
              { header: "Check-out" },
              { header: "Total", align: "right" },
              { header: "Due", align: "right" },
              { header: "Status" },
            ]}
            rows={bookings.map((b) => ({
              key: b.id,
              details: {
                title: b.booking_code,
                subtitle: `${rel(b.guests as { full_name: string } | null)?.full_name ?? "Guest"} · ${bookingLabel(b.status)}`,
                fields: [
                  { label: "Guest", value: rel(b.guests as { full_name: string } | null)?.full_name },
                  { label: "Room", value: rel(b.rooms as { room_number: string } | null)?.room_number },
                  { label: "Check-in", value: formatDate(b.check_in_date) },
                  { label: "Check-out", value: formatDate(b.check_out_date) },
                  { label: "Status", value: bookingLabel(b.status) },
                  { label: "Source", value: labelize(b.source ?? "") },
                  { label: "Guests", value: `${b.adults} adult${b.adults === 1 ? "" : "s"}, ${b.children} child${b.children === 1 ? "" : "ren"}` },
                  { label: "AC", value: b.ac_option === "non_ac" ? "Non-AC" : "AC" },
                  { label: "Room rate / night", value: formatMoney(b.room_rate) },
                  { label: "Extra bed", value: formatMoney(b.extra_bed_charge) },
                  { label: "Additional charges", value: formatMoney(b.additional_charges) },
                  { label: "Room extra charges", value: formatMoney(b.folio_total) },
                  { label: "Discount", value: formatMoney(b.discount_amount) },
                  { label: "GST on invoice", value: formatMoney(b.tax_total) },
                  { label: "Total", value: formatMoney(b.total_amount) },
                  { label: "Paid", value: formatMoney(b.amount_paid) },
                  { label: "Balance due", value: formatMoney(b.balance_due) },
                  { label: "Created", value: formatDate(b.created_at) },
                  { label: "Notes", value: b.notes, wide: true },
                ],
                actions: (
                  <>
                    <Link href={`/bookings/${b.id}`} className={btnPrimary}>Open booking</Link>
                    {Number(b.balance_due) > 0 ? (
                      <Link href={`/payments/new?booking_id=${b.id}`} className={btnSoft}>Record payment</Link>
                    ) : null}
                  </>
                ),
              },
              cells: [
                <Link key="c" href={`/bookings/${b.id}`} className="font-medium text-[var(--brand)] hover:underline">
                  {b.booking_code}
                </Link>,
                rel(b.guests as { full_name: string } | null)?.full_name,
                rel(b.rooms as { room_number: string } | null)?.room_number,
                formatDate(b.check_in_date),
                formatDate(b.check_out_date),
                formatMoney(b.total_amount),
                formatMoney(b.balance_due),
                <StatusPill key="s" tone={bookingTone(b.status)}>{bookingLabel(b.status)}</StatusPill>,
              ],
            }))}
          />
        </Panel>
      )}
    </div>
  );
}
