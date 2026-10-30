import Link from "next/link";
import { PageHeader, Panel, EmptyState, btnPrimary, btnSoft } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { addDays, dayLabel, diffDays, isDateString, todayLocal } from "@/lib/dates";
import { ROOM_CATEGORY_LABELS, bookingLabel, type RoomCategory } from "@/lib/types";

const DAYS = 14;

type Cell = {
  id: string;
  code: string;
  guest: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
};

// Higher number wins when two bookings of one room overlap on a day
// (e.g. an old checked-out stay and a later active one).
const PRIORITY: Record<string, number> = { checked_in: 4, confirmed: 3, hold: 2, checked_out: 1 };

const STATUS_STYLE: Record<string, string> = {
  checked_in: "bg-sky-500 text-white",
  confirmed: "bg-violet-100 text-violet-800",
  hold: "bg-rose-100 text-rose-800",
  checked_out: "bg-stone-200 text-stone-600",
};

export default async function BookingCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const { start: startParam } = await searchParams;
  const today = todayLocal();
  const start = isDateString(startParam) ? startParam : today;
  const end = addDays(start, DAYS);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));

  const supabase = await createClient();
  const [{ data: rooms }, { data: bookings }] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, room_number, status, category")
      .eq("is_active", true)
      .order("room_number"),
    supabase
      .from("bookings")
      .select("id, booking_code, room_id, status, check_in_date, check_out_date, guests(full_name)")
      .in("status", ["hold", "confirmed", "checked_in", "checked_out"])
      .lt("check_in_date", end)
      .gt("check_out_date", start),
  ]);

  const byRoom = new Map<string, Cell[]>();
  for (const b of bookings || []) {
    const g = b.guests as { full_name: string } | { full_name: string }[] | null;
    const guest = (Array.isArray(g) ? g[0] : g)?.full_name ?? "Guest";
    const list = byRoom.get(b.room_id) ?? [];
    list.push({
      id: b.id,
      code: b.booking_code,
      guest,
      status: b.status,
      check_in_date: b.check_in_date,
      check_out_date: b.check_out_date,
    });
    byRoom.set(b.room_id, list);
  }

  /** One <td> per run of days covered by the same booking (or by nothing). */
  function rowCells(roomId: string) {
    const list = byRoom.get(roomId) ?? [];
    const cells: { booking: Cell | null; span: number; from: string }[] = [];
    for (const day of days) {
      const covering = list
        .filter((b) => b.check_in_date <= day && day < b.check_out_date)
        .sort((a, b) => (PRIORITY[b.status] ?? 0) - (PRIORITY[a.status] ?? 0))[0];
      const last = cells[cells.length - 1];
      // Consecutive days of the same booking merge into one wide cell;
      // empty days stay separate so each can link to a booking for that day.
      if (covering && last?.booking?.id === covering.id) {
        last.span += 1;
      } else {
        cells.push({ booking: covering ?? null, span: 1, from: day });
      }
    }
    return cells;
  }

  const prev = addDays(start, -DAYS);
  const next = addDays(start, DAYS);
  const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

  return (
    <div className="space-y-4">
      <PageHeader
        title="Booking calendar"
        description="Rooms down the side, dates across. Click a booking to open it, or an empty cell to book that night."
        actions={
          <>
            <Link href="/bookings" className={btnSoft}>
              List view
            </Link>
            <Link href="/bookings/new" className={btnPrimary}>
              New booking
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/bookings/calendar?start=${prev}`} className={btnSoft}>
          ← Previous
        </Link>
        <Link href="/bookings/calendar" className={btnSoft}>
          Today
        </Link>
        <Link href={`/bookings/calendar?start=${next}`} className={btnSoft}>
          Next →
        </Link>
        <span className="ml-2 text-[var(--muted)]">
          {dayLabel(start).day} {dayLabel(start).month} – {dayLabel(addDays(end, -1)).day}{" "}
          {dayLabel(addDays(end, -1)).month}
        </span>
        <span className="ml-auto flex flex-wrap gap-3 text-xs text-[var(--muted)]">
          {Object.keys(STATUS_STYLE).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`inline-block h-3 w-3 rounded ${STATUS_STYLE[s]}`} />
              {bookingLabel(s)}
            </span>
          ))}
        </span>
      </div>

      {!rooms?.length ? (
        <EmptyState message="No rooms yet. Add rooms first." />
      ) : (
        <Panel className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-28 bg-[var(--panel)] px-3 py-2 text-left font-medium text-[var(--muted)]">
                    Room
                  </th>
                  {days.map((d) => {
                    const l = dayLabel(d);
                    return (
                      <th
                        key={d}
                        className={`px-1 py-2 text-center font-medium ${
                          d === today ? "bg-[var(--brand-soft)] text-[var(--brand)]" : isWeekend(d) ? "bg-stone-50" : ""
                        }`}
                      >
                        <span className="block text-[10px] uppercase text-[var(--muted)]">{l.weekday}</span>
                        {l.day} {l.month}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => {
                  const typeName = ROOM_CATEGORY_LABELS[room.category as RoomCategory];
                  const blockedNow = ["maintenance", "blocked"].includes(room.status);
                  return (
                    <tr key={room.id} className="border-t border-[var(--line)]">
                      <td className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2">
                        <Link href={`/rooms/${room.id}`} className="font-semibold hover:underline">
                          {room.room_number}
                        </Link>
                        <span className="block truncate text-[10px] text-[var(--muted)]">
                          {typeName}
                          {blockedNow ? <span className="font-medium text-orange-600"> · {room.status}</span> : null}
                        </span>
                      </td>
                      {rowCells(room.id).map((c) =>
                        c.booking ? (
                          <td key={c.from} colSpan={c.span} className="p-0.5">
                            <Link
                              href={`/bookings/${c.booking.id}`}
                              title={`${c.booking.code} · ${c.booking.guest} · ${c.booking.check_in_date} → ${c.booking.check_out_date} · ${bookingLabel(c.booking.status)}`}
                              className={`block truncate rounded-lg px-2 py-2 font-medium ${STATUS_STYLE[c.booking.status] ?? "bg-stone-100"}`}
                            >
                              {c.booking.guest}
                            </Link>
                          </td>
                        ) : (
                          <td
                            key={c.from}
                            className={`p-0.5 ${c.from === today ? "bg-[var(--brand-tint)]" : isWeekend(c.from) ? "bg-stone-50" : ""}`}
                          >
                            {blockedNow || c.from < today ? (
                              <span
                                className={`block rounded-lg py-2 text-center ${blockedNow ? "bg-orange-50 text-orange-600" : ""}`}
                              >
                                {blockedNow ? "—" : ""}
                              </span>
                            ) : (
                              <Link
                                href={`/bookings/new?check_in=${c.from}&check_out=${addDays(c.from, 1)}&room_id=${room.id}`}
                                aria-label={`Book room ${room.room_number} on ${c.from}`}
                                className="block rounded-lg py-2 text-center text-transparent hover:bg-[var(--brand-tint)] hover:text-[var(--brand)]"
                              >
                                +
                              </Link>
                            )}
                          </td>
                        ),
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <p className="text-xs text-[var(--muted)]">
        Cancelled and no-show bookings do not block a room, so they are not drawn here.
        {diffDays(start, today) > 0 ? " Viewing past dates." : ""}
      </p>
    </div>
  );
}
