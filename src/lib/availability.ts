import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOCKING_BOOKING_STATUSES } from "@/lib/types";

export type FreeRoom = {
  id: string;
  room_number: string;
  status: string;
  category: string;
};

/**
 * Active rooms that are ready to receive a guest (available/reserved) and have no
 * hold/confirmed/checked-in booking overlapping [from, to).
 */
export async function readyRooms(
  supabase: SupabaseClient,
  from: string,
  to: string,
  excludeBookingId?: string,
): Promise<FreeRoom[]> {
  const [{ data: rooms }, { data: clashes }] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, room_number, status, category")
      .eq("is_active", true)
      .in("status", ["available", "reserved"])
      .order("room_number"),
    supabase
      .from("bookings")
      .select("id, room_id")
      .in("status", BLOCKING_BOOKING_STATUSES)
      .lt("check_in_date", to)
      .gt("check_out_date", from),
  ]);
  const taken = new Set(
    (clashes || []).filter((c) => c.id !== excludeBookingId).map((c) => c.room_id),
  );
  return (rooms || [])
    .filter((r) => !taken.has(r.id))
    .map((r) => ({
        id: r.id,
        room_number: r.room_number,
        status: r.status,
        category: r.category,
      }));
}
