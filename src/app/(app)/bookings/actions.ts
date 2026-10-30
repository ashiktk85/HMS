"use server";

import { requireUser, writeAudit } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { diffDays, isDateString, todayLocal } from "@/lib/dates";
import {
  BLOCKING_BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  type BookingSource,
  type BookingStatus,
} from "@/lib/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const SOURCES: BookingSource[] = ["direct", "walk_in", "phone", "whatsapp"];
const CREATE_STATUSES: BookingStatus[] = ["hold", "confirmed"];

function money(formData: FormData, name: string) {
  return Math.round(Number(formData.get(name) || 0) * 100) / 100;
}

/** Creates a booking. Returns { error } on failure; redirects to the booking on success. */
export async function createBooking(formData: FormData): Promise<{ error: string }> {
  const session = await requireUser();
  const supabase = await createClient();

  const guestId = String(formData.get("guest_id") || "");
  const roomId = String(formData.get("room_id") || "");
  const checkIn = String(formData.get("check_in_date") || "");
  const checkOut = String(formData.get("check_out_date") || "");
  const status = String(formData.get("status") || "confirmed") as BookingStatus;
  const source = String(formData.get("source") || "direct") as BookingSource;

  if (!guestId) return { error: "Select a guest" };
  if (!roomId) return { error: "Select a room" };
  if (!isDateString(checkIn) || !isDateString(checkOut)) {
    return { error: "Enter valid check-in and check-out dates" };
  }
  if (diffDays(checkIn, checkOut) < 1) {
    return { error: "Check-out must be after check-in" };
  }
  if (checkIn < todayLocal()) return { error: "Check-in date is in the past" };
  if (!CREATE_STATUSES.includes(status)) return { error: "Invalid status" };
  if (!SOURCES.includes(source)) return { error: "Invalid booking source" };

  const roomRate = money(formData, "room_rate");
  const discount = money(formData, "discount_amount");
  const extraBed = money(formData, "extra_bed_charge");
  const additional = money(formData, "additional_charges");
  const adults = Number(formData.get("adults") || 1);
  const children = Number(formData.get("children") || 0);
  if ([roomRate, discount, extraBed, additional].some((n) => !Number.isFinite(n) || n < 0)) {
    return { error: "Amounts cannot be negative" };
  }
  if (!Number.isInteger(adults) || adults < 1) return { error: "At least 1 adult is required" };
  if (!Number.isInteger(children) || children < 0) return { error: "Children cannot be negative" };
  const gross = roomRate * diffDays(checkIn, checkOut) + extraBed + additional;
  if (discount > gross) return { error: "Discount is more than the booking total" };

  // Optional advance, collected with the booking. Checked here so nothing is created if it can't be taken.
  const advance = money(formData, "advance_amount");
  const advanceMethodId = String(formData.get("advance_method_id") || "");
  const advanceRef = String(formData.get("advance_reference") || "").trim();
  if (!Number.isFinite(advance) || advance < 0) return { error: "Advance cannot be negative" };
  if (advance > 0) {
    if (advance > Math.round((gross - discount) * 100) / 100) {
      return { error: "Advance is more than the booking total" };
    }
    if (!advanceMethodId) return { error: "Choose how the advance was paid" };
    const { data: method } = await supabase
      .from("payment_methods")
      .select("name, requires_reference")
      .eq("id", advanceMethodId)
      .eq("is_active", true)
      .maybeSingle();
    if (!method) return { error: "Choose how the advance was paid" };
    if (method.requires_reference && !advanceRef) {
      return { error: `${method.name} payments need a transaction reference` };
    }
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("status, is_active, room_number")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || !room.is_active) return { error: "Room not found" };
  if (["maintenance", "blocked"].includes(room.status)) {
    return { error: `Room ${room.room_number} is ${room.status} and cannot be booked` };
  }

  // Friendly pre-check (applies to enquiries too: they need free dates but don't hold the room).
  // The database trigger remains the real guarantee.
  {
    const { data: clash } = await supabase
      .from("bookings")
      .select("booking_code, check_in_date, check_out_date")
      .eq("room_id", roomId)
      .in("status", BLOCKING_BOOKING_STATUSES)
      .lt("check_in_date", checkOut)
      .gt("check_out_date", checkIn)
      .limit(1)
      .maybeSingle();
    if (clash) {
      return {
        error: `Room ${room.room_number} is already booked ${clash.check_in_date} to ${clash.check_out_date} (${clash.booking_code})`,
      };
    }
  }

  const payload = {
    guest_id: guestId,
    room_id: roomId,
    source,
    status,
    check_in_date: checkIn,
    check_out_date: checkOut,
    adults,
    children,
    room_rate: roomRate,
    discount_amount: discount,
    extra_bed_charge: extraBed,
    additional_charges: additional,
    ac_option: formData.get("ac_option") === "non_ac" ? "non_ac" : "ac",
    notes: String(formData.get("notes") || "").trim() || null,
    created_by: session.user.id,
    booking_code: "",
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(payload)
    .select("id")
    .single();
  if (error) return { error: error.message };

  await writeAudit("create", "bookings", data.id, payload);

  if (advance > 0) {
    // Same database function as Payments, so the receipt, ledger and balance all update together.
    // Receiving an advance also moves an on-hold booking to confirmed.
    const { error: payErr } = await supabase.rpc("record_payment", {
      p_booking_id: data.id,
      p_amount: advance,
      p_method_id: advanceMethodId,
      p_reference: advanceRef || null,
      p_notes: "Advance paid at booking",
    });
    if (payErr) {
      revalidatePath("/bookings");
      return {
        error: `The booking was created, but the advance could not be recorded (${payErr.message}). Open the booking and record the payment there; do not create it again.`,
      };
    }
  }

  revalidatePath("/payments");
  revalidatePath("/bookings");
  revalidatePath("/bookings/calendar");
  redirect(`/bookings/${data.id}`);
}

export async function updateBookingStatus(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const id = String(formData.get("booking_id") || "");
  const status = String(formData.get("status") || "") as BookingStatus;
  const note = String(formData.get("note") || "").trim() || null;

  const { data: booking } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!booking) return { error: "Booking not found" };
  if (!BOOKING_TRANSITIONS[booking.status as BookingStatus]?.includes(status)) {
    return { error: `A ${booking.status.replace("_", " ")} booking cannot become ${status.replace("_", " ")}` };
  }

  // The overlap trigger re-checks dates when a cancelled booking is reopened.
  const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  if (note) {
    const { data: latest } = await supabase
      .from("booking_status_history")
      .select("id")
      .eq("booking_id", id)
      .eq("to_status", status)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      await supabase.from("booking_status_history").update({ notes: note }).eq("id", latest.id);
    }
  }

  await writeAudit("status_change", "bookings", id, { from: booking.status, to: status, note });
  revalidatePath(`/bookings/${id}`);
  revalidatePath("/bookings");
  revalidatePath("/bookings/calendar");
  return { ok: true };
}

type Result = { ok: true } | { error: string };

export async function checkInBooking(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id") || "");
  const additionalGuests = Number(formData.get("additional_guests") || 0);
  if (!Number.isInteger(additionalGuests) || additionalGuests < 0) {
    return { error: "Additional guests must be 0 or more" };
  }

  // One transaction in the database: check-in record, booking, room and audit log.
  const { error } = await supabase.rpc("check_in_booking", {
    p_booking_id: bookingId,
    p_room_id: String(formData.get("room_id") || "") || null,
    p_id_verified: formData.get("id_verified") === "on",
    p_additional_guests: additionalGuests,
    p_notes: String(formData.get("notes") || "").trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/bookings");
  revalidatePath("/bookings/calendar");
  revalidatePath("/rooms");
  return { ok: true };
}

export async function changeRoom(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id") || "");
  const newRoom = String(formData.get("room_id") || "");
  if (!newRoom) return { error: "Select the new room" };

  const { error } = await supabase.rpc("change_room", {
    p_booking_id: bookingId,
    p_new_room_id: newRoom,
    p_reason: String(formData.get("reason") || "").trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/bookings/calendar");
  revalidatePath("/rooms");
  revalidatePath("/housekeeping");
  return { ok: true };
}

export async function addFolioCharge(formData: FormData): Promise<Result> {
  const session = await requireUser();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id") || "");
  const description = String(formData.get("description") || "").trim();
  const quantity = Number(formData.get("quantity") || 1);
  const unitAmount = Number(formData.get("unit_amount") || 0);
  const serviceItemId = String(formData.get("service_item_id") || "") || null;

  if (!description) return { error: "Description required" };
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: "Quantity must be more than 0" };
  if (!Number.isFinite(unitAmount) || unitAmount < 0) return { error: "Amount cannot be negative" };

  const { data: booking } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found" };
  if (booking.status !== "checked_in") {
    return { error: "Charges can only be added while the guest is in-house" };
  }

  const amount = Math.round(quantity * unitAmount * 100) / 100;
  const { data, error } = await supabase
    .from("folio_charges")
    .insert({
      booking_id: bookingId,
      service_item_id: serviceItemId,
      description,
      quantity,
      unit_amount: unitAmount,
      amount,
      created_by: session.user.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await writeAudit("create", "folio_charges", data.id, { bookingId, description, amount });
  revalidatePath(`/bookings/${bookingId}`);
  return { ok: true };
}

export async function voidFolioCharge(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id") || "");
  const { error } = await supabase.rpc("void_folio_charge", {
    p_charge_id: String(formData.get("charge_id") || ""),
    p_reason: String(formData.get("reason") || ""),
  });
  if (error) return { error: error.message };
  revalidatePath(`/bookings/${bookingId}`);
  return { ok: true };
}

export async function checkOutBooking(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id") || "");

  // One transaction: check-out record, booking, room -> dirty, housekeeping task, audit log.
  const { error } = await supabase.rpc("check_out_booking", {
    p_booking_id: bookingId,
    p_allow_outstanding: formData.get("allow_outstanding") === "on",
    p_notes: String(formData.get("notes") || "").trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/bookings");
  revalidatePath("/bookings/calendar");
  revalidatePath("/rooms");
  revalidatePath("/housekeeping");
  return { ok: true };
}
