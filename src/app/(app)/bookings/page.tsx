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
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/lib/dates";
import { BOOKING_STATUSES, bookingTone, formatDate, formatMoney, labelize, rel } from "@/lib/types";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; when?: string }>;
}) {
  const { status, q, when } = await searchParams;
  const today = todayLocal();
  const supabase = await createClient();

  let query = supabase
    .from("bookings")
    .select("*, guests(full_name), rooms(room_number)")
    .order("created_at", { ascending: false });
  if (status && (BOOKING_STATUSES as string[]).includes(status)) {
    query = query.eq("status", status);
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
      <Panel className="mb-4 space-y-3">
        <form className="flex gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {when ? <input type="hidden" name="when" value={when} /> : null}
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
              {labelize(s)}
            </Link>
          ))}
        </div>
      </Panel>
      {!bookings?.length ? (
        <EmptyState message={term || status || when ? "No bookings match." : "No bookings yet."} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Code</th>
                  <th className="font-medium">Guest</th>
                  <th className="font-medium">Room</th>
                  <th className="font-medium">Dates</th>
                  <th className="font-medium">Total</th>
                  <th className="font-medium">Due</th>
                  <th className="font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-t border-[var(--line)]">
                    <td className="py-3">
                      <Link href={`/bookings/${b.id}`} className="font-medium text-[var(--brand)] hover:underline">
                        {b.booking_code}
                      </Link>
                    </td>
                    <td>{rel(b.guests as { full_name: string } | null)?.full_name}</td>
                    <td>{rel(b.rooms as { room_number: string } | null)?.room_number}</td>
                    <td className="whitespace-nowrap">
                      {formatDate(b.check_in_date)} → {formatDate(b.check_out_date)}
                    </td>
                    <td>{formatMoney(b.total_amount)}</td>
                    <td>{formatMoney(b.balance_due)}</td>
                    <td>
                      <StatusPill tone={bookingTone(b.status)}>{labelize(b.status)}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
