import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { BLOCKING_BOOKING_STATUSES, rel, type RoomCategory } from "@/lib/types";
import { addDays, isDateString, todayLocal } from "@/lib/dates";
import { BookingForm, type RoomInfo, type Stay } from "./BookingForm";

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{
    check_in?: string;
    check_out?: string;
    room_id?: string;
    guest_id?: string;
  }>;
}) {
  const sp = await searchParams;
  const today = todayLocal();
  const hasDates =
    isDateString(sp.check_in) &&
    isDateString(sp.check_out) &&
    sp.check_in >= today &&
    sp.check_out > sp.check_in;
  const checkIn = hasDates ? sp.check_in! : today;
  const checkOut = hasDates ? sp.check_out! : addDays(today, 1);

  const supabase = await createClient();
  const [{ data: allRooms }, { data: upcoming }, { data: guestRows }, { data: methods }] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, room_number, status, category, floor, base_rate, max_occupancy")
      .eq("is_active", true)
      .order("room_number"),
    // Live bookings that have not ended yet: the form uses them to show who has each room
    // and when it frees up, for whatever dates are typed in.
    supabase
      .from("bookings")
      .select("room_id, status, check_in_date, check_out_date, guests(full_name)")
      .in("status", BLOCKING_BOOKING_STATUSES)
      .gt("check_out_date", today)
      .order("check_in_date"),
    supabase.from("guests").select("id, full_name, mobile").order("full_name").limit(1000),
    supabase
      .from("payment_methods")
      .select("id, name, requires_reference")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  const byRoom = new Map<string, Stay[]>();
  for (const b of upcoming || []) {
    const list = byRoom.get(b.room_id) ?? [];
    list.push({
      status: b.status,
      from: b.check_in_date,
      to: b.check_out_date,
      guest: rel(b.guests as { full_name: string } | { full_name: string }[] | null)?.full_name ?? "Guest",
    });
    byRoom.set(b.room_id, list);
  }
  const rooms: RoomInfo[] = (allRooms || []).map((r) => ({
    id: r.id,
    room_number: r.room_number,
    category: r.category as RoomCategory,
    floor: r.floor,
    status: r.status,
    base_rate: Number(r.base_rate ?? 0),
    max_occupancy: Number(r.max_occupancy ?? 2),
    stays: byRoom.get(r.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="New booking"
        description="Every room is shown below with its status. Pick a room, then fill in the details."
        actions={
          <Link href="/bookings" className="text-sm font-medium text-[var(--brand)] hover:underline">
            Back
          </Link>
        }
      />

      <Panel>
        <BookingForm
          guests={guestRows || []}
          methods={methods || []}
          rooms={rooms}
          today={today}
          defaultCheckIn={checkIn}
          defaultCheckOut={checkOut}
          defaultGuestId={sp.guest_id}
          defaultRoomId={sp.room_id}
        />
      </Panel>
    </div>
  );
}
